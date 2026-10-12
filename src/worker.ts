import { MetaCell } from './meta-cell';
import { SessionCell } from './session-cell';
import { constantTimeEqual, signToken, verifyToken } from './server/auth';
import { errorJson, json, parseBearer } from './server/http';
import { handleProbeCompute, handleProbeRows } from './server/probe';
import { getModels } from './server/models';
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
	// Cloudflare always sets cf-connecting-ip in production; local tests must set it explicitly.
	return request.headers.get('cf-connecting-ip') ?? 'unknown';
}

// Best-effort throttle: read-modify-write on Cache API, so concurrent guesses
// advance the counter by ~1 per round. No atomic counter without a DO/KV, and
// D1 is forbidden on the unauthenticated path — this is intentionally best-effort.
async function isThrottled(request: Request): Promise<boolean> {
	const ip = getClientIp(request);
	const cache = caches.default;
	const key = new Request(`https://throttle/login/${encodeURIComponent(ip)}`, { method: 'GET' });
	const cached = await cache.match(key);
	if (!cached) return false;
	const text = await cached.text();
	const count = parseInt(text, 10) || 0;
	return count >= 5;
}

async function recordFailedAttempt(request: Request): Promise<void> {
	const ip = getClientIp(request);
	const cache = caches.default;
	const key = new Request(`https://throttle/login/${encodeURIComponent(ip)}`, { method: 'GET' });
	const cached = await cache.match(key);
	let count = 0;
	if (cached) {
		const text = await cached.text();
		count = parseInt(text, 10) || 0;
	}
	const next = String(count + 1);
	const res = new Response(next, {
		headers: { 'Cache-Control': 'max-age=900', 'content-type': 'text/plain' },
	});
	await cache.put(key, res.clone());
}

async function requireUserAuth(request: Request, env: Env): Promise<Response | null> {
	if (!env.TOKEN_SECRET) {
		console.error('TOKEN_SECRET is not set — refusing auth');
		return errorJson('Server misconfigured', 500);
	}
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

		// Health — cheap liveness, no DO touch (finding 7). Authenticated pong check is /api/healthz.
		if (url.pathname === '/api/health' && request.method === 'GET') {
			return json({ ok: true });
		}
		if (url.pathname === '/api/healthz' && request.method === 'GET') {
			const authErr = await requireUserAuth(request, env);
			if (authErr) return authErr;
			const meta = env.META.getByName('index');
			const session = env.SESSIONS.getByName('smoke');
			return json({
				ok: true,
				meta: await meta.ping(),
				session: await session.ping(),
			});
		}

		// Login — no auth, but throttled (only failed passphrase checks count)
		if (url.pathname === '/api/login' && request.method === 'POST') {
			if (await isThrottled(request)) {
				return errorJson('Too many login attempts, try again later', 429);
			}

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
			if (!env.SUGU_PASSPHRASE) {
				console.error('SUGU_PASSPHRASE is not set — refusing login');
				return errorJson('Server misconfigured', 500);
			}
			if (!env.TOKEN_SECRET) {
				console.error('TOKEN_SECRET is not set — refusing login');
				return errorJson('Server misconfigured', 500);
			}
			if (!parsed.output.passphrase) {
				await recordFailedAttempt(request);
				return errorJson('Wrong passphrase', 401);
			}
			const ok = await constantTimeEqual(parsed.output.passphrase, env.SUGU_PASSPHRASE);
			if (!ok) {
				await recordFailedAttempt(request);
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

		// Quota — user token required, one row-read
		if (url.pathname === '/api/quota' && request.method === 'GET') {
			const authErr = await requireUserAuth(request, env);
			if (authErr) return authErr;
			try {
				const meta = env.META.getByName('index');
				const row = await meta.getUsage(new Date().toISOString().slice(0, 10));
				return json(row ?? { day: new Date().toISOString().slice(0, 10), turns: 0, prompt_t: 0, compl_t: 0, cost_usd: 0, tools: 0 });
			} catch {
				return json({ day: new Date().toISOString().slice(0, 10), turns: 0, prompt_t: 0, compl_t: 0, cost_usd: 0, tools: 0 });
			}
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

		// GET /api/models — token-authed, live catalogue with caching
		if (url.pathname === '/api/models' && request.method === 'GET') {
			const authErr = await requireUserAuth(request, env);
			if (authErr) return authErr;
			const result = await getModels(
				env as unknown as { SUGU_MODELS?: string; SUGU_MODELS_URL?: string; SUGU_MODELS_FILTER?: string; MODEL_STUB?: string },
			);
			return json(result);
		}

		// PATCH /api/sessions/:id — rename and/or model
		if (
			url.pathname.startsWith('/api/sessions/') &&
			request.method === 'PATCH' &&
			!url.pathname.endsWith('/export') &&
			!url.pathname.endsWith('/events')
		) {
			const authErr = await requireUserAuth(request, env);
			if (authErr) return authErr;
			const id = url.pathname.slice('/api/sessions/'.length).split('/')[0] ?? '';
			if (!id) return errorJson('Missing id', 400);
			let body: unknown;
			try {
				const t = await request.text();
				body = t ? JSON.parse(t) : {};
			} catch {
				return errorJson('Invalid JSON', 400);
			}
			const parsed = v.safeParse(v.strictObject({ title: v.optional(v.string()), model: v.optional(v.string()) }), body);
			if (!parsed.success) return errorJson('Invalid body', 400);
			const meta = env.META.getByName('index');
			const existing = await meta.get(id);
			if (!existing) return errorJson('Not found', 404);
			if (parsed.output.title !== undefined) {
				const trimmed = parsed.output.title.trim();
				if (!trimmed) return errorJson('Title cannot be empty', 400);
				const updated = await meta.rename(id, trimmed);
				if (!updated) return errorJson('Not found', 404);
				// Also update model if provided
				if (parsed.output.model !== undefined) {
					await meta.touch({ id, model: parsed.output.model.trim() });
					const refreshed = await meta.get(id);
					return json(refreshed!);
				}
				return json(updated);
			}
			if (parsed.output.model !== undefined) {
				await meta.touch({ id, model: parsed.output.model.trim() });
				const refreshed = await meta.get(id);
				return json(refreshed!);
			}
			return json(existing);
		}

		// DELETE /api/sessions/:id — idempotent
		if (
			url.pathname.startsWith('/api/sessions/') &&
			request.method === 'DELETE' &&
			!url.pathname.endsWith('/export') &&
			!url.pathname.endsWith('/events')
		) {
			const authErr = await requireUserAuth(request, env);
			if (authErr) return authErr;
			const id = url.pathname.slice('/api/sessions/'.length).split('/')[0] ?? '';
			if (!id) return errorJson('Missing id', 400);
			const meta = env.META.getByName('index');
			await meta.remove(id);
			// Idempotent: always 200, even if already absent.
			// Note: we do not delete the SessionCell's SQLite — there is no API to drop a DO.
			return json({ ok: true });
		}

		// GET /api/sessions/:id/export — JSONL download
		if (url.pathname.endsWith('/export') && request.method === 'GET' && url.pathname.startsWith('/api/sessions/')) {
			const authErr = await requireUserAuth(request, env);
			if (authErr) return authErr;
			const parts = url.pathname.slice('/api/sessions/'.length).split('/');
			const id = parts[0] ?? '';
			if (!id) return errorJson('Missing id', 400);
			const meta = env.META.getByName('index');
			const existing = await meta.get(id);
			if (!existing) return errorJson('Not found', 404);
			const sid = env.SESSIONS.idFromName(id);
			const stub = env.SESSIONS.get(sid);
			const jsonl = await (stub as unknown as { exportJsonl: () => Promise<string> }).exportJsonl();
			return new Response(jsonl, {
				headers: {
					'content-type': 'text/plain; charset=utf-8',
					'content-disposition': `attachment; filename="${id}.jsonl"`,
				},
			});
		}

		// GET /api/sessions/:id/events — paged history
		if (url.pathname.endsWith('/events') && request.method === 'GET' && url.pathname.startsWith('/api/sessions/')) {
			const authErr = await requireUserAuth(request, env);
			if (authErr) return authErr;
			const parts = url.pathname.slice('/api/sessions/'.length).split('/');
			const id = parts[0] ?? '';
			if (!id) return errorJson('Missing id', 400);
			const meta = env.META.getByName('index');
			const existing = await meta.get(id);
			if (!existing) return errorJson('Not found', 404);
			const beforeRaw = url.searchParams.get('before');
			const limitRaw = url.searchParams.get('limit');
			const before = beforeRaw !== null ? Number(beforeRaw) : undefined;
			const limit = limitRaw !== null ? Number(limitRaw) : undefined;
			if (beforeRaw !== null && (!Number.isFinite(before!) || before! < 0)) return errorJson('Invalid before', 400);
			if (limitRaw !== null && (!Number.isFinite(limit!) || limit! < 1)) return errorJson('Invalid limit', 400);
			const sid = env.SESSIONS.idFromName(id);
			const stub = env.SESSIONS.get(sid);
			const page = await (stub as unknown as { eventsPage: (o: unknown) => Promise<unknown> }).eventsPage({ before, limit });
			return json(page);
		}

		// WebSocket upgrade — auth gate BEFORE touching the DO
		if (url.pathname === '/ws' && request.method === 'GET') {
			const token = url.searchParams.get('token');
			if (!token) {
				return errorJson('Unauthorized', 401);
			}
			if (!env.TOKEN_SECRET) {
				console.error('TOKEN_SECRET is not set — refusing WS auth');
				return errorJson('Server misconfigured', 500);
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
