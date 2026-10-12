import { DurableObject } from 'cloudflare:workers';
import { nowIso } from './shared/time';
import type { SessionMeta } from './shared/contracts';

export class MetaCell extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		this.ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS sessions (
				id         TEXT PRIMARY KEY,
				title      TEXT NOT NULL,
				model      TEXT NOT NULL DEFAULT 'deepseek-chat',
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				last_seq   INTEGER NOT NULL DEFAULT 0,
				archived   INTEGER NOT NULL DEFAULT 0
			)
		`);
	}

	async ping(): Promise<string> {
		return 'pong';
	}

	async list(opts?: { includeArchived?: boolean }): Promise<SessionMeta[]> {
		const includeArchived = opts?.includeArchived ?? false;
		const sql = includeArchived
			? 'SELECT * FROM sessions ORDER BY updated_at DESC'
			: 'SELECT * FROM sessions WHERE archived = 0 ORDER BY updated_at DESC';
		const cursor = this.ctx.storage.sql.exec(sql);
		const rows: SessionMeta[] = [];
		for (const row of cursor) {
			rows.push(rowToMeta(row as Record<string, unknown>));
		}
		return rows;
	}

	async create(opts: { id: string; title: string; model?: string }): Promise<SessionMeta> {
		const now = nowIso();
		const model = opts.model ?? 'deepseek-chat';
		const title = opts.title.slice(0, 60);
		this.ctx.storage.sql.exec(
			'INSERT INTO sessions (id, title, model, created_at, updated_at, last_seq, archived) VALUES (?, ?, ?, ?, ?, 0, 0)',
			opts.id,
			title,
			model,
			now,
			now,
		);
		return {
			id: opts.id,
			title,
			model,
			createdAt: now,
			updatedAt: now,
			lastSeq: 0,
			archived: false,
		};
	}

	async touch(opts: { id: string; lastSeq?: number; title?: string }): Promise<void> {
		const now = nowIso();
		const sets: string[] = ['updated_at = ?'];
		const params: unknown[] = [now];
		if (opts.lastSeq !== undefined) {
			sets.push('last_seq = ?');
			params.push(opts.lastSeq);
		}
		if (opts.title !== undefined) {
			sets.push('title = ?');
			params.push(opts.title.slice(0, 60));
		}
		params.push(opts.id);
		this.ctx.storage.sql.exec(`UPDATE sessions SET ${sets.join(', ')} WHERE id = ?`, ...params);
	}

	async remove(id: string): Promise<void> {
		this.ctx.storage.sql.exec('DELETE FROM sessions WHERE id = ?', id);
	}
}

function rowToMeta(row: Record<string, unknown>): SessionMeta {
	return {
		id: row['id'] as string,
		title: row['title'] as string,
		model: row['model'] as string,
		createdAt: row['created_at'] as string,
		updatedAt: row['updated_at'] as string,
		lastSeq: row['last_seq'] as number,
		archived: Boolean(row['archived']),
	};
}
