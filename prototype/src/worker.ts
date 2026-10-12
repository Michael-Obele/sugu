import { MetaCell } from './meta-cell';
import { SessionCell } from './session-cell';

export { MetaCell, SessionCell };

/**
 * Worker entry. Two jobs: route, and hand off.
 *
 * - `/api/*` → REST handlers           (login, sessions, quota, import)
 * - `/ws`    → the conversation's SessionCell
 * - other    → the static SPA in the ASSETS binding
 *
 * Everything real lands in the next task; the bodies below exist so the wiring
 * (assets binding, DO bindings, SQLite) can be proven before any logic is written.
 */
export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/api/health') {
			const meta = env.META.getByName('index');
			const session = env.SESSIONS.getByName('smoke');
			return Response.json({
				ok: true,
				meta: await meta.ping(),
				session: await session.ping()
			});
		}

		if (url.pathname === '/ws') {
			return new Response('websocket endpoint not implemented yet', { status: 501 });
		}

		if (url.pathname.startsWith('/api/')) {
			return new Response('api not implemented yet', { status: 501 });
		}

		// Static assets. Unknown paths resolve to index.html, because wrangler.jsonc
		// sets not_found_handling: "single-page-application".
		return env.ASSETS.fetch(request);
	}
} satisfies ExportedHandler<Env>;
