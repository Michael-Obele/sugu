import { MetaCell } from './meta-cell';
import { SessionCell } from './session-cell';
import { constantTimeEqual, signToken, verifyToken } from './server/auth';
import { errorJson, json, parseBearer } from './server/http';
import { handleProbeCompute, handleProbeRows } from './server/probe';
import * as v from 'valibot';

export { MetaCell, SessionCell };

const LoginSchema = v.strictObject({
	passphrase: v.string(),
});

const CreateSessionSchema = v.strictObject({
	title: v.optional(v.string()),
	model: v.optional(v.string()),
});

function getClientIp(request: Request): string {
	return (
		request.headers.get('cf-connecting-ip') ??
		request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
		request.headers.get('x-real-ip') ??
		'unknown'
	);
}

async function checkLoginThrottle(request: Request): Promise<Response | null> {
	const ip = getClientIp(request);
	const cache = caches.default;
	const key = new Request(`https://throttle/login/${encodeURIComponent(ip)}`, { method: 'GET' });
	const cached = await cache.match(key);
	let count = 0;
	if (cached) {
		const text = await cached.text();
		count = parseInt(text, 10) || 0;
	}
	if (count >= 5) {
		return errorJson('Too many login attempts, try again later', 429);
	}
	// Increment and store with 15-minute expiry
	const next = String(count + 1);
	const res = new Response(next, {
		headers: { 'Cache-Control': 'max-age=900', 'content-type': 'text/plain' },
	});
	// Use put with cache key; workerd Cache API respects Cache-Control for expiry
	await cache.put(key, res.clone());
	return null;
}

async function requireUserAuth(request: Request, env: Env): Promise<Response | null> {
	const token = parseBearer(request);
	if (!token) return errorJson('Unauthorized', 401);
	const result = await verifyToken(token, env.TOKEN_SECRET);
	if (!result.ok) return errorJson('Unauthorized', 401);
	return null;
}

async function requireAdminAuth(request: Request, env: Env): Promise<Response | null> {
	const token = parseBearer(request);
	if (!token) return errorJson('Unauthorized', 401);
	// Use constantTimeEqual to avoid timing oracle on admin token
	const ok = await constantTimeEqual(token, env.ADMIN_TOKEN ?? '');
	if (!ok) return errorJson('Unauthorized', 401);
	return null;
}

export default {
	async fetch(request, env): Promise<Response> {
		const url = new URL(request.url);

		// Health — keep working, no auth
		if (url.pathname === '/api/health' && request.method === 'GET') {
			const meta = env.META.getByName('index');
			const session = env.SESSIONS.getByName('smoke');
			return json({
				ok: true,
				meta: await meta.ping(),
				session: await session.ping(),
			});
		}

		// Login — no auth, but throttled
		if (url.pathname === '/api/login' && request.method === 'POST') {
			const throttled = await checkLoginThrottle(request);
			if (throttled) return throttled;

			let body: unknown;
			try {
				body = await request.json();
			} catch {
				return errorJson('Invalid JSON', 400);
			}
			const parsed = v.safeParse(LoginSchema, body);
			if (!parsed.success) {
				return errorJson('Invalid body', 400);
			}
			const ok = await constantTimeEqual(parsed.output.passphrase, env.SUGU_PASSPHRASE ?? '');
			if (!ok) {
				return errorJson('Wrong passphrase', 401);
			}
			const token = await signToken(env.TOKEN_SECRET);
			return json({ token });
		}

		// Probe endpoints — admin token only
		if (url.pathname === '/api/probe/compute' && request.method === 'POST') {
			const authErr = await requireAdminAuth(request, env);
			if (authErr) return authErr;
			return handleProbeCompute(request);
		}
		if (url.pathname === '/api/probe/rows' && request.method === 'POST') {
			const authErr = await requireAdminAuth(request, env);
			if (authErr) return authErr;
			return handleProbeRows(request, env);
		}

		// Sessions — user token required
		if (url.pathname === '/api/sessions' && request.method === 'GET') {
			const authErr = await requireUserAuth(request, env);
			if (authErr) return authErr;
			const meta = env.META.getByName('index');
			const sessions = await meta.list();
			return json(sessions);
		}
		if (url.pathname === '/api/sessions' && request.method === 'POST') {
			const authErr = await requireUserAuth(request, env);
			if (authErr) return authErr;
			let body: unknown = {};
			try {
				const text = await request.text();
				if (text) body = JSON.parse(text);
			} catch {
				return errorJson('Invalid JSON', 400);
			}
			const parsed = v.safeParse(CreateSessionSchema, body);
			if (!parsed.success) {
				return errorJson('Invalid body', 400);
			}
			const id = crypto.randomUUID();
			const title = parsed.output.title?.trim() || 'New session';
			const model = parsed.output.model?.trim() || 'deepseek-chat';
			const meta = env.META.getByName('index');
			const created = await meta.create({ id, title, model });
			return json(created, 201);
		}

		// WebSocket upgrade — auth gate BEFORE touching the DO
		if (url.pathname === '/ws' && request.method === 'GET') {
			const token = url.searchParams.get('token');
			if (!token) {
				return errorJson('Unauthorized', 401);
			}
			const result = await verifyToken(token, env.TOKEN_SECRET);
			if (!result.ok) {
				return errorJson('Unauthorized', 401);
			}
			const sessionId = url.searchParams.get('sessionId') ?? url.searchParams.get('session_id');
			if (!sessionId || sessionId.trim() === '') {
				return errorJson('Missing sessionId', 400);
			}
			const id = env.SESSIONS.idFromName(sessionId);
			const stub = env.SESSIONS.get(id);
			return stub.fetch(request);
		}

		// Unknown /api/* -> 404 JSON
		if (url.pathname.startsWith('/api/')) {
			return errorJson('Not found', 404);
		}

		// Assets fallback (SPA)
		return env.ASSETS.fetch(request);
	},
} satisfies ExportedHandler<Env>;
