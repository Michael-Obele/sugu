import { DurableObject } from 'cloudflare:workers';

/**
 * MetaCell holds the session index, so listing conversations never has to wake every
 * SessionCell. It is a cache: the SessionCell event tables stay authoritative.
 *
 * Stub: proves the binding and SQLite work. The real implementation is the next task.
 */
export class MetaCell extends DurableObject<Env> {
	async ping(): Promise<string> {
		this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS _ping (t TEXT)');
		return 'pong';
	}
}
