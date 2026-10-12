import { DurableObject } from 'cloudflare:workers';
import { nowIso } from './shared/time';
import { parseFrame } from './shared/contracts';
import { verifyToken } from './server/auth';
import type { Frame } from './shared/contracts';

type EnvWithSecrets = Env & { TOKEN_SECRET: string };

export class SessionCell extends DurableObject<Env> {
	private busy = false;
	private abortCtrl: AbortController | null = null;
	// ponytail: token frames carry seq = MAX(id)+1 at turn start. This assumes
	// nothing writes an event mid-turn; when tools land in Phase 1, reserve the
	// row at turn start instead (ceiling: ~100k rows/day free tier).
	private pendingSeq: number | null = null;
	private pendingText = '';

	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		const sql = this.ctx.storage.sql;
		sql.exec(`
			CREATE TABLE IF NOT EXISTS events (
				id      INTEGER PRIMARY KEY AUTOINCREMENT,
				ts      TEXT NOT NULL,
				type    TEXT NOT NULL,
				role    TEXT,
				payload TEXT NOT NULL,
				meta    TEXT
			)
		`);
		sql.exec('CREATE INDEX IF NOT EXISTS events_type_idx ON events(type)');
		sql.exec(`
			CREATE TABLE IF NOT EXISTS todos (
				id       INTEGER PRIMARY KEY AUTOINCREMENT,
				text     TEXT NOT NULL,
				status   TEXT NOT NULL DEFAULT 'open',
				pos      INTEGER NOT NULL,
				event_id INTEGER
			)
		`);
		sql.exec(`
			CREATE TABLE IF NOT EXISTS tool_runs (
				id       TEXT PRIMARY KEY,
				name     TEXT NOT NULL,
				args     TEXT NOT NULL,
				status   TEXT NOT NULL,
				result   TEXT,
				ts_start TEXT NOT NULL,
				ts_end   TEXT
			)
		`);
		sql.exec(`
			CREATE TABLE IF NOT EXISTS skills_cache (
				name       TEXT PRIMARY KEY,
				source     TEXT NOT NULL,
				path       TEXT NOT NULL,
				content    TEXT NOT NULL,
				fetched_at TEXT NOT NULL
			)
		`);
		sql.exec(`
			CREATE TABLE IF NOT EXISTS usage (
				day       TEXT PRIMARY KEY,
				turns     INTEGER NOT NULL DEFAULT 0,
				prompt_t  INTEGER NOT NULL DEFAULT 0,
				compl_t   INTEGER NOT NULL DEFAULT 0,
				cost_usd  REAL    NOT NULL DEFAULT 0,
				tools     INTEGER NOT NULL DEFAULT 0
			)
		`);
	}

	async ping(): Promise<string> {
		return 'pong';
	}

	// Test helper: snapshot events for integration tests
	async snapshot(): Promise<{ id: number; type: string; role: string | null; payload: string }[]> {
		const cursor = this.ctx.storage.sql.exec('SELECT id, type, role, payload FROM events ORDER BY id ASC');
		return [...cursor] as unknown as { id: number; type: string; role: string | null; payload: string }[];
	}

	async fetch(request: Request): Promise<Response> {
		const upgrade = request.headers.get('Upgrade');
		if (upgrade !== 'websocket') {
			return new Response('expected websocket', { status: 426 });
		}
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
		this.ctx.acceptWebSocket(server);
		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
		let raw: unknown;
		try {
			raw = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message));
		} catch {
			ws.send(JSON.stringify({ v: 1, t: 'err', code: 'bad_frame', message: 'invalid JSON' }));
			return;
		}
		const parsed = parseFrame(raw);
		if (!parsed.ok) {
			ws.send(JSON.stringify({ v: 1, t: 'err', code: 'bad_frame', message: 'bad frame' }));
			return;
		}
		const frame = parsed.frame;

		switch (frame.t) {
			case 'hello':
				await this.handleHello(ws, frame);
				break;
			case 'send':
				await this.handleSend(ws, frame);
				break;
			case 'cancel':
				await this.handleCancel(ws);
				break;
			case 'ack':
				// no-op for now
				break;
			case 'approve':
				// Phase 2 — acknowledge but no-op
				break;
			default:
				// Server frames sent by client are bad_frame
				ws.send(JSON.stringify({ v: 1, t: 'err', code: 'bad_frame', message: `unexpected frame: ${(frame as Frame).t}` }));
				break;
		}
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
		ws.close(code, reason);
		void wasClean;
	}

	async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
		void ws;
		void error;
	}

	private async handleHello(ws: WebSocket, frame: Extract<Frame, { t: 'hello' }>): Promise<void> {
		const secret = (this.env as EnvWithSecrets).TOKEN_SECRET ?? '';
		const result = await verifyToken(frame.token, secret);
		if (!result.ok) {
			ws.send(JSON.stringify({ v: 1, t: 'err', code: 'auth', message: result.reason }));
			try {
				ws.close(1008, result.reason);
			} catch {
				// ignore
			}
			return;
		}
		const since = frame.since ?? 0;
		// Replay events with id > since
		const cursor = this.ctx.storage.sql.exec('SELECT id, type, role, payload, meta FROM events WHERE id > ? ORDER BY id ASC', since);
		for (const row of cursor) {
			const r = row as unknown as { id: number; type: string; role: string | null; payload: string; meta: string | null };
			const frameToSend = eventRowToFrame(r);
			if (frameToSend) {
				ws.send(JSON.stringify(frameToSend));
			}
		}
		// Send fresh state
		ws.send(JSON.stringify(this.buildStateFrame()));
	}

	private async handleSend(ws: WebSocket, frame: Extract<Frame, { t: 'send' }>): Promise<void> {
		if (this.busy) {
			ws.send(JSON.stringify({ v: 1, t: 'err', code: 'busy', message: 'already busy' }));
			return;
		}
		this.busy = true;
		const ts = nowIso();
		// Persist user message
		this.ctx.storage.sql.exec(
			'INSERT INTO events (ts, type, role, payload, meta) VALUES (?, ?, ?, ?, ?)',
			ts,
			'user',
			'user',
			JSON.stringify({ text: frame.text }),
			null,
		);
		// Determine seq for the assistant row that will be persisted
		const maxRow = this.ctx.storage.sql.exec('SELECT MAX(id) as maxId FROM events').one() as unknown as { maxId: number | null };
		const nextSeq = (maxRow.maxId ?? 0) + 1;
		this.pendingSeq = nextSeq;
		this.pendingText = '';

		// Stream echo as token frames (Phase 0: echo)
		const echoText = `echo: ${frame.text}`;
		this.abortCtrl = new AbortController();
		const signal = this.abortCtrl.signal;

		// Simulate streaming: split into chunks
		const chunks = chunkString(echoText, 8);
		for (const chunk of chunks) {
			if (signal.aborted) break;
			this.pendingText += chunk;
			ws.send(JSON.stringify({ v: 1, t: 'token', seq: nextSeq, delta: chunk }));
			await new Promise<void>((resolve) => setTimeout(resolve, 5));
			if (signal.aborted) break;
		}

		if (signal.aborted) {
			// Persist partial as interrupted
			const interruptedTs = nowIso();
			this.ctx.storage.sql.exec(
				'INSERT INTO events (ts, type, role, payload, meta) VALUES (?, ?, ?, ?, ?)',
				interruptedTs,
				'assistant',
				'assistant',
				JSON.stringify({ text: this.pendingText, interrupted: true }),
				null,
			);
			// Notify client of interrupted msg
			const row = this.ctx.storage.sql.exec('SELECT id FROM events ORDER BY id DESC LIMIT 1').one() as unknown as { id: number };
			ws.send(
				JSON.stringify({
					v: 1,
					t: 'msg',
					seq: row.id,
					id: row.id,
					role: 'assistant',
					text: this.pendingText,
					interrupted: true,
				}),
			);
			ws.send(JSON.stringify(this.buildStateFrame()));
			this.busy = false;
			this.pendingSeq = null;
			this.pendingText = '';
			this.abortCtrl = null;
			return;
		}

		// Persist final assistant message
		const assistantTs = nowIso();
		this.ctx.storage.sql.exec(
			'INSERT INTO events (ts, type, role, payload, meta) VALUES (?, ?, ?, ?, ?)',
			assistantTs,
			'assistant',
			'assistant',
			JSON.stringify({ text: echoText }),
			null,
		);
		const row = this.ctx.storage.sql.exec('SELECT id FROM events ORDER BY id DESC LIMIT 1').one() as unknown as { id: number };
		ws.send(
			JSON.stringify({
				v: 1,
				t: 'msg',
				seq: row.id,
				id: row.id,
				role: 'assistant',
				text: echoText,
			}),
		);
		ws.send(JSON.stringify(this.buildStateFrame()));
		this.busy = false;
		this.pendingSeq = null;
		this.pendingText = '';
		this.abortCtrl = null;
	}

	private async handleCancel(ws: WebSocket): Promise<void> {
		if (!this.busy || !this.abortCtrl) return;
		this.abortCtrl.abort();
		// The handleSend loop will detect abort and persist interrupted
		// We also handle the case where abort happens before any token
		void ws;
	}

	private buildStateFrame(): Frame {
		const todos: Frame[] = [];
		void todos;
		const cursor = this.ctx.storage.sql.exec('SELECT id, text, status, pos FROM todos ORDER BY pos ASC');
		const todoList: { id: number; text: string; status: 'open' | 'done' | 'dropped'; pos: number }[] = [];
		for (const row of cursor) {
			const r = row as unknown as { id: number; text: string; status: string; pos: number };
			todoList.push({ id: r.id, text: r.text, status: r.status as 'open' | 'done' | 'dropped', pos: r.pos });
		}
		const maxRow = this.ctx.storage.sql.exec('SELECT MAX(id) as maxId FROM events').one() as unknown as { maxId: number | null };
		const seq = maxRow.maxId ?? 0;
		return {
			v: 1,
			t: 'state',
			seq,
			todos: todoList,
			busy: this.busy,
			model: 'deepseek-chat',
		} as Frame;
	}
}

function eventRowToFrame(row: {
	id: number;
	type: string;
	role: string | null;
	payload: string;
	meta: string | null;
}): Record<string, unknown> | null {
	const payload = JSON.parse(row.payload) as Record<string, unknown>;
	switch (row.type) {
		case 'user':
		case 'assistant': {
			const msg: Record<string, unknown> = {
				v: 1,
				t: 'msg',
				seq: row.id,
				id: row.id,
				role: row.role ?? 'user',
				text: payload['text'] ?? '',
			};
			if (payload['interrupted']) msg['interrupted'] = true;
			return msg;
		}
		case 'tool': {
			return {
				v: 1,
				t: 'tool',
				seq: row.id,
				runId: payload['runId'] ?? String(row.id),
				name: payload['name'] ?? 'unknown',
				status: payload['status'] ?? 'ok',
				summary: payload['summary'],
			};
		}
		case 'interrupted': {
			return {
				v: 1,
				t: 'msg',
				seq: row.id,
				id: row.id,
				role: 'assistant',
				text: payload['text'] ?? '',
				interrupted: true,
			};
		}
		default:
			return null;
	}
}

function chunkString(s: string, size: number): string[] {
	const chunks: string[] = [];
	for (let i = 0; i < s.length; i += size) {
		chunks.push(s.slice(i, i + size));
	}
	return chunks;
}
