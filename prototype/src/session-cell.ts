import { DurableObject } from 'cloudflare:workers';

/**
 * One SessionCell per conversation. It owns the event log, the agent loop and the
 * hibernating WebSocket for that conversation.
 *
 * Stub: proves the binding and SQLite work. The real implementation is the next task.
 */
export class SessionCell extends DurableObject<Env> {
	async ping(): Promise<string> {
		this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS _ping (t TEXT)');
		return 'pong';
	}
}
