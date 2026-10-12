import { MetaCell } from './meta-cell';
import { SessionCell } from './session-cell';

export { MetaCell, SessionCell };

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === '/api/health') {
			const meta = env.META.getByName('index');
			const session = env.SESSIONS.getByName('smoke');
			return Response.json({
				ok: true,
				meta: await meta.ping(),
				session: await session.ping(),
			});
		}

		if (url.pathname === '/ws') {
			const sessionId = url.searchParams.get('sessionId') ?? url.searchParams.get('session_id') ?? 'default';
			const id = env.SESSIONS.idFromName(sessionId);
			const stub = env.SESSIONS.get(id);
			return stub.fetch(request);
		}

		if (url.pathname.startsWith('/api/')) {
			return new Response('api not implemented yet', { status: 501 });
		}

		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
