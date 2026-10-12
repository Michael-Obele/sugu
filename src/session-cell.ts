import { DurableObject } from 'cloudflare:workers';
import { nowIso } from './shared/time';
import { parseFrame } from './shared/contracts';
import { verifyToken } from './server/auth';
import { resolveAdapter } from './server/models';
import type { Frame } from './shared/contracts';
import type { Msg } from './server/models';

type EnvWithSecrets = Env & { TOKEN_SECRET: string };
type EnvWithModels = Env & {
	TOKEN_SECRET: string;
	DEEPSEEK_API_KEY?: string;
	OPENROUTER_API_KEY?: string;
	MODEL_STUB?: string;
	MODEL_STUB_FAIL?: string;
	MODEL_STUB_TEXT?: string;
};

export class SessionCell extends DurableObject<Env> {
	private busy = false;
	private abortCtrl: AbortController | null = null;
	// reservation: at turn start we INSERT the assistant row immediately with
	// empty text and meta { interrupted: true } and capture its id as seq. Token
	// frames and the final msg reuse that seq; on completion we UPDATE the same
	// row (interrupted: false) so an eviction mid-stream still leaves a durable
	// msg { interrupted: true } for replay. Row budget: user insert (1) +
	// assistant reserve (1) + assistant update (1) = 3 writes/turn (limit 8).
	private pendingSeq: number | null = null;
	private pendingText = '';
	private pendingAssistantId: number | null = null;
	private activeWs: WebSocket | null = null;

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
		sql.exec(`
			CREATE TABLE IF NOT EXISTS meta (
				key   TEXT PRIMARY KEY,
				value TEXT NOT NULL
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

	// Phase-0-only: quota probe helper. Deleted along with the probe endpoints after Phase 0.
	async probeWrite(count: number): Promise<number> {
		const n = Math.floor(count);
		if (n <= 0) return 0;
		// Bound total probe rows so the probe cannot eat the free tier's row/storage budget.
		const PROBE_ROWS_CEILING = 50_000;
		const existing = this.ctx.storage.sql.exec("SELECT COUNT(*) as c FROM events WHERE type = 'probe'").one() as unknown as { c: number };
		if (existing.c + n > PROBE_ROWS_CEILING) {
			throw new Error(`probe rows ceiling exceeded: ${existing.c} existing + ${n} requested > ${PROBE_ROWS_CEILING}`);
		}
		for (let i = 0; i < n; i++) {
			this.ctx.storage.sql.exec(
				'INSERT INTO events (ts, type, role, payload, meta) VALUES (?, ?, ?, ?, ?)',
				nowIso(),
				'probe',
				null,
				JSON.stringify({ n: i }),
				null,
			);
		}
		return n;
	}

	async getUsage(
		day: string,
	): Promise<{ day: string; turns: number; prompt_t: number; compl_t: number; cost_usd: number; tools: number } | null> {
		const row = this.ctx.storage.sql
			.exec('SELECT day, turns, prompt_t, compl_t, cost_usd, tools FROM usage WHERE day = ?', day)
			.one() as unknown as { day: string; turns: number; prompt_t: number; compl_t: number; cost_usd: number; tools: number } | undefined;
		if (!row) return null;
		return row;
	}

	async snapshotWithMeta(): Promise<{ id: number; type: string; role: string | null; payload: string; meta: string | null }[]> {
		const cursor = this.ctx.storage.sql.exec('SELECT id, type, role, payload, meta FROM events ORDER BY id ASC');
		return [...cursor] as unknown as { id: number; type: string; role: string | null; payload: string; meta: string | null }[];
	}

	// Batch 2A: paged history — reuse eventRowToFrame so live and replay agree.
	// Returns frames in ascending seq order (oldest first), consistent with WS replay.
	async eventsPage(opts: { before?: number; limit?: number }): Promise<{ frames: Frame[]; hasMore: boolean }> {
		const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
		const before = opts.before;
		let cursor;
			if (before !== undefined) {
			cursor = this.ctx.storage.sql.exec('SELECT id, type, role, payload, meta FROM events WHERE id < ? ORDER BY id DESC LIMIT ?', before, limit + 1);
		} else {
			cursor = this.ctx.storage.sql.exec('SELECT id, type, role, payload, meta FROM events ORDER BY id DESC LIMIT ?', limit + 1);
		}
		const rows = [...cursor] as unknown as { id: number; type: string; role: string | null; payload: string; meta: string | null }[];
		const hasMore = rows.length > limit;
		const pageRows = hasMore ? rows.slice(0, limit) : rows;
		// Reverse to ascending order (oldest first) — consistent with WS replay
		pageRows.reverse();
		const frames: Frame[] = [];
		for (const r of pageRows) {
			const f = eventRowToFrame(r);
			if (f) frames.push(f as Frame);
		}
		return { frames, hasMore };
	}

	async exportJsonl(): Promise<string> {
		const lines: string[] = [];
		lines.push(JSON.stringify({ version: 1 }));
		const cursor = this.ctx.storage.sql.exec('SELECT id, ts, type, payload FROM events ORDER BY id ASC');
		for (const row of cursor) {
			const r = row as unknown as { id: number; ts: string; type: string; payload: string };
			let payload: unknown;
			try { payload = JSON.parse(r.payload); } catch { payload = {}; }
			lines.push(JSON.stringify({ seq: r.id, ts: r.ts, type: r.type, payload }));
		}
		return lines.join('\n') + '\n';
	}

	// Session id persistence (survives DO eviction)
	private getSessionId(): string | null {
		try {
			const row = this.ctx.storage.sql.exec("SELECT value FROM meta WHERE key = 'sessionId'").one() as unknown as { value: string } | undefined;
			return row?.value ?? null;
		} catch { return null; }
	}

	private setSessionId(id: string): void {
		this.ctx.storage.sql.exec("INSERT INTO meta (key, value) VALUES ('sessionId', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", id);
	}

	private isFirstUserMessage(): boolean {
		const row = this.ctx.storage.sql.exec("SELECT COUNT(*) as c FROM events WHERE type = 'user'").one() as unknown as { c: number };
		return row.c === 0;
	}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (url.searchParams.get('__snapshot') === '1') {
			const rows = await this.snapshotWithMeta();
			return Response.json(rows);
		}
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
			{
				const msg = parsed.issues[0]?.message ?? 'bad frame';
				const isTooLong = msg.includes('length') || msg.includes('max');
				ws.send(
					JSON.stringify({ v: 1, t: 'err', code: 'bad_frame', message: isTooLong ? 'message too long (max 8000 chars)' : 'bad frame' }),
				);
			}
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
				// Phase 2 -- acknowledge but no-op
				break;
			default:
				// Server frames sent by client are bad_frame
				ws.send(JSON.stringify({ v: 1, t: 'err', code: 'bad_frame', message: `unexpected frame: ${(frame as Frame).t}` }));
				break;
		}
	}

	// The platform has already closed this socket, so there is nothing to do here. Do NOT
	// call ws.close() again: it re-sends the peer's status code, and a browser close that
	// carries no status arrives as 1005, which is reserved and invalid to send, so every
	// disconnect threw `InvalidAccessError: Invalid WebSocket close code: 1005`.
	async webSocketClose(ws: WebSocket, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
		if (this.activeWs === ws) this.activeWs = null;
		if (!this.busy || !this.abortCtrl) return;
		// Phone dropped mid-stream (D7 / AR failure-mode table): abort upstream work,
		// persist partial as interrupted, clear busy so reconnect can send again.
		this.abortCtrl.abort();
		// Give handleSend's abort path a chance to run; if it hasn't persisted yet
		// (e.g. close arrived before the loop's next yield), persist here.
		// Use queueMicrotask to let the abort branch in handleSend run first if it will.
		await new Promise<void>((r) => queueMicrotask(() => r()));
		if (this.pendingAssistantId !== null) {
			try {
				this.ctx.storage.sql.exec(
					'UPDATE events SET payload = ?, meta = ? WHERE id = ?',
					JSON.stringify({ text: this.pendingText }),
					JSON.stringify({ interrupted: true }),
					this.pendingAssistantId,
				);
			} catch {
				// ignore
			}
			this.busy = false;
			this.pendingSeq = null;
			this.pendingText = '';
			this.pendingAssistantId = null;
			this.abortCtrl = null;
		}
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
		// Persist sessionId from hello (survives DO eviction, needed for title)
		if (frame.sessionId) {
			const existing = this.getSessionId();
			if (!existing) this.setSessionId(frame.sessionId);
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
		try {
			ws.send(JSON.stringify(this.buildStateFrame()));
		} catch {
			/* socket gone */
		}
	}

	private async handleSend(ws: WebSocket, frame: Extract<Frame, { t: 'send' }>): Promise<void> {
		if (this.busy) {
			ws.send(JSON.stringify({ v: 1, t: 'err', code: 'busy', message: 'already busy' }));
			return;
		}
		this.busy = true;
		const ts = nowIso();
		// Title: set from first user line, once per session (AR-6 budget)
		const isFirst = this.isFirstUserMessage();
		let firstTitle: string | null = null;
		if (isFirst) {
			const firstLine = frame.text.split('\n')[0]!.trim().slice(0, 60);
			if (firstLine) firstTitle = firstLine;
		}
		// Persist user message
		this.ctx.storage.sql.exec(
			'INSERT INTO events (ts, type, role, payload, meta) VALUES (?, ?, ?, ?, ?)',
			ts,
			'user',
			'user',
			JSON.stringify({ text: frame.text }),
			null,
		);
		if (firstTitle) {
			const sid = this.getSessionId();
			if (sid) {
				try {
					const metaNs = (this.env as unknown as { META: DurableObjectNamespace }).META;
					if (metaNs) {
						(metaNs.getByName('index') as unknown as { touch: (o: unknown) => Promise<void> })
							.touch({ id: sid, title: firstTitle })
							.catch(() => {});
					}
				} catch { /* ignore */ }
			}
		}
		// Emit the same msg frame replay would produce -- one event, one shape, both paths.
		{
			const userRowId = (this.ctx.storage.sql.exec('SELECT last_insert_rowid() as id').one() as unknown as { id: number }).id;
			const userFrame = eventRowToFrame({
				id: userRowId,
				type: 'user',
				role: 'user',
				payload: JSON.stringify({ text: frame.text }),
				meta: null,
			});
			if (userFrame) ws.send(JSON.stringify(userFrame));
		}
		// Reserve assistant row immediately with empty text and interrupted:true.
		// This makes the interruption durable: if the DO is evicted mid-stream
		// the row survives and replays as msg { interrupted: true }.
		const reserveTs = nowIso();
		this.ctx.storage.sql.exec(
			'INSERT INTO events (ts, type, role, payload, meta) VALUES (?, ?, ?, ?, ?)',
			reserveTs,
			'assistant',
			'assistant',
			JSON.stringify({ text: '' }),
			JSON.stringify({ interrupted: true }),
		);
		const reserved = this.ctx.storage.sql.exec('SELECT last_insert_rowid() as id').one() as unknown as { id: number };
		const nextSeq = reserved.id;
		this.pendingSeq = nextSeq;
		this.pendingAssistantId = nextSeq;
		this.pendingText = '';
		// Server-authoritative busy: every socket learns a turn is running (finding 1).
		try {
			try {
				ws.send(JSON.stringify(this.buildStateFrame()));
			} catch {
				/* socket gone */
			}
		} catch {
			// socket already gone — webSocketClose will handle abort
		}
		this.activeWs = ws;

		this.abortCtrl = new AbortController();
		const signal = this.abortCtrl.signal;

		// Build prompt: system + capped history
		const messages = this.buildMessages(frame.text);
		const model = 'deepseek-chat';

		let finalText = '';
		let promptTokens = 0;
		let completionTokens = 0;
		let costUsd = 0;
		let modelError: string | null = null;

		try {
			const adapter = resolveAdapter(model, this.env as EnvWithModels);
			for await (const chunk of adapter.stream({ model, messages, maxTokens: 4096 }, signal)) {
				if (signal.aborted) break;
				if (chunk.delta) {
					// AR-8: no frame > 16 KB — truncate delta if needed
					let delta = chunk.delta;
					if (finalText.length + delta.length > 16000) {
						delta = delta.slice(0, 16000 - finalText.length - 14) + '…[truncated]';
					}
					if (delta.length === 0) continue;
					finalText += delta;
					this.pendingText = finalText;
					try {
						ws.send(JSON.stringify({ v: 1, t: 'token', seq: nextSeq, delta }));
					} catch {
						this.abortCtrl?.abort();
						break;
					}
				}
				if (chunk.usage) {
					promptTokens = chunk.usage.promptTokens ?? 0;
					completionTokens = chunk.usage.completionTokens ?? 0;
					costUsd = chunk.usage.costUsd ?? 0;
				}
				// toolCall is out of scope for Task 4 — ignored
			}
		} catch (e) {
			if (signal.aborted) {
				// Aborted — will be handled as interrupted below
			} else {
				modelError = e instanceof Error ? e.message : String(e);
			}
		}

		if (signal.aborted) {
			// Update reserved row with partial text, still interrupted
			this.ctx.storage.sql.exec(
				'UPDATE events SET payload = ?, meta = ? WHERE id = ?',
				JSON.stringify({ text: this.pendingText }),
				JSON.stringify({ interrupted: true }),
				this.pendingAssistantId,
			);
			try {
				ws.send(
					JSON.stringify({
						v: 1,
						t: 'msg',
						seq: this.pendingAssistantId,
						id: this.pendingAssistantId,
						role: 'assistant',
						text: this.pendingText,
						interrupted: true,
					}),
				);
			} catch {
				// socket gone
			}
			this.busy = false;
			this.pendingSeq = null;
			this.pendingText = '';
			this.pendingAssistantId = null;
			this.abortCtrl = null;
			if (this.activeWs === ws) this.activeWs = null;
			try {
				ws.send(JSON.stringify(this.buildStateFrame()));
			} catch {
				/* socket gone */
			}
			return;
		}

		if (modelError) {
			// Model failure: persist partial (if any) as interrupted, send err, clear busy
			const textToPersist = finalText || this.pendingText;
			this.ctx.storage.sql.exec(
				'UPDATE events SET payload = ?, meta = ? WHERE id = ?',
				JSON.stringify({ text: textToPersist }),
				JSON.stringify({ interrupted: true }),
				this.pendingAssistantId,
			);
			try {
				ws.send(
					JSON.stringify({
						v: 1,
						t: 'msg',
						seq: this.pendingAssistantId,
						id: this.pendingAssistantId,
						role: 'assistant',
						text: textToPersist,
						interrupted: true,
					}),
				);
			} catch {
				/* socket gone */
			}
			try {
				ws.send(JSON.stringify({ v: 1, t: 'err', code: 'model', message: 'model error' }));
			} catch {
				/* socket gone */
			}
			// Record usage even on failure (turn still counts)
			this.recordUsage(0, 0, 0);
			this.busy = false;
			this.pendingSeq = null;
			this.pendingText = '';
			this.pendingAssistantId = null;
			this.abortCtrl = null;
			if (this.activeWs === ws) this.activeWs = null;
			try {
				ws.send(JSON.stringify(this.buildStateFrame()));
			} catch {
				/* socket gone */
			}
			return;
		}

		// Success: persist final text, interrupted:false — then busy=false (order matters: see reservation comment)
		// AR-8: truncate final if needed
		if (finalText.length > 16000) finalText = finalText.slice(0, 15970) + '…[truncated]';
		this.ctx.storage.sql.exec(
			'UPDATE events SET payload = ?, meta = ? WHERE id = ?',
			JSON.stringify({ text: finalText }),
			JSON.stringify({ interrupted: false }),
			this.pendingAssistantId,
		);
		// Record usage: one upsert per turn (AR-6: ≤8 row-writes/turn)
		this.recordUsage(promptTokens, completionTokens, costUsd);
		try {
			ws.send(
				JSON.stringify({
					v: 1,
					t: 'msg',
					seq: this.pendingAssistantId,
					id: this.pendingAssistantId,
					role: 'assistant',
					text: finalText,
				}),
			);
		} catch {
			// socket gone
		}
		this.busy = false;
		this.pendingSeq = null;
		this.pendingText = '';
		this.pendingAssistantId = null;
		this.abortCtrl = null;
		if (this.activeWs === ws) this.activeWs = null;
		try {
			ws.send(JSON.stringify(this.buildStateFrame()));
		} catch {
			/* socket gone */
		}
	}

	private async handleCancel(_ws: WebSocket): Promise<void> {
		if (!this.busy || !this.abortCtrl) return;
		this.abortCtrl.abort();
	}

	private buildMessages(currentText: string): Msg[] {
		// Caps: last 20 messages, total prompt ≤ 24k chars (protects CPU/payload budget AR-4/AR-5).
		// 20 messages ≈ ~10 turns; 24k chars ≈ ~6k tokens, well within context windows.
		const MAX_HISTORY = 20;
		const MAX_PROMPT_CHARS = 24_000;
		const SYSTEM_PROMPT = 'You are Sugu, a helpful phone-first assistant. Be concise.';

		const messages: Msg[] = [{ role: 'system', content: SYSTEM_PROMPT }];

		// Read recent history from events (user + assistant only)
		const cursor = this.ctx.storage.sql.exec(
			"SELECT type, role, payload FROM events WHERE type IN ('user', 'assistant') ORDER BY id DESC LIMIT ?",
			MAX_HISTORY,
		);
		const rows = [...cursor].reverse() as unknown as { type: string; role: string | null; payload: string }[];
		for (const row of rows) {
			try {
				const payload = JSON.parse(row.payload) as { text: string };
				const content = payload.text ?? '';
				if (!content) continue;
				// Skip the just-inserted user message — we add currentText separately to avoid double
				// (the SELECT includes it, but we want it as the final user turn)
				// Instead, include all history and append currentText as last user message
				const role = (row.role as Msg['role']) ?? 'user';
				if (role === 'user' || role === 'assistant') {
					messages.push({ role, content });
				}
			} catch {
				// ignore malformed
			}
		}
		// The SELECT already includes the current user message; avoid duplicating it.
		// If last message is already the current text as user, don't append again.
		const last = messages[messages.length - 1];
		if (!last || last.role !== 'user' || last.content !== currentText) {
			messages.push({ role: 'user', content: currentText });
		}

		// Enforce total prompt size cap: drop oldest non-system messages first
		let total = messages.reduce((sum, m) => sum + m.content.length, 0);
		while (total > MAX_PROMPT_CHARS && messages.length > 2) {
			// Remove oldest non-system message (index 1)
			const removed = messages.splice(1, 1)[0]!;
			total -= removed.content.length;
		}
		return messages;
	}

	private recordUsage(promptT: number, complT: number, costUsd: number): void {
		const day = new Date().toISOString().slice(0, 10);
		this.ctx.storage.sql.exec(
			'INSERT INTO usage (day, turns, prompt_t, compl_t, cost_usd, tools) VALUES (?, 1, ?, ?, ?, 0) ON CONFLICT(day) DO UPDATE SET turns = turns + 1, prompt_t = prompt_t + excluded.prompt_t, compl_t = compl_t + excluded.compl_t, cost_usd = cost_usd + excluded.cost_usd',
			day,
			promptT,
			complT,
			costUsd,
		);
		// Also update global quota in MetaCell for /api/quota (best-effort, no await)
		try {
			const metaNs = (this.env as unknown as { META: DurableObjectNamespace }).META;
			if (metaNs) {
				(metaNs.getByName('index') as unknown as { recordUsage: (d: string, p: number, c: number, cost: number) => Promise<void> })
					.recordUsage(day, promptT, complT, costUsd)
					.catch(() => {});
			}
		} catch {
			// ignore — quota aggregation is best-effort
		}
	}

	private buildStateFrame(): Frame {
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
			let interrupted = payload['interrupted'];
			if (row.meta) {
				try {
					const meta = JSON.parse(row.meta) as Record<string, unknown>;
					if (meta['interrupted'] === true) interrupted = true;
					if (meta['interrupted'] === false) interrupted = false;
				} catch {
					// ignore malformed meta
				}
			}
			if (interrupted) msg['interrupted'] = true;
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
