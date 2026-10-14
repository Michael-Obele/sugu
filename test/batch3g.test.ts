import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { signToken } from '../src/server/auth';
import { startDevServer, TEST_SECRETS, type DevServer } from './helpers/server';
import { resolveDefaultModel, BUILTIN_DEFAULT_MODEL } from '../src/server/models';

let BASE: string;
let WS_BASE: string;
let _server: DevServer;
const SECRET = TEST_SECRETS.TOKEN_SECRET;

function authHeader(token: string): Record<string, string> {
	return { Authorization: `Bearer ${token}` };
}

function wsConnect(sessionId: string, token: string): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`${WS_BASE}/ws?sessionId=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}`);
		ws.addEventListener('open', () => {
			ws.send(JSON.stringify({ v: 1, t: 'hello', sessionId, token }));
			resolve(ws);
		});
		ws.addEventListener('error', (e) => reject(e));
		setTimeout(() => reject(new Error('ws connect timeout')), 5000);
	});
}

function waitForFrames(
	ws: WebSocket,
	predicate: (frames: Record<string, unknown>[]) => boolean,
	timeoutMs = 5000
): Promise<Record<string, unknown>[]> {
	return new Promise((resolve, reject) => {
		const frames: Record<string, unknown>[] = [];
		const onMessage = (event: MessageEvent) => {
			try {
				frames.push(JSON.parse(event.data as string));
				if (predicate(frames)) {
					cleanup();
					resolve(frames);
				}
			} catch {
				/* ignore */
			}
		};
		const cleanup = () => {
			ws.removeEventListener('message', onMessage);
			clearTimeout(timer);
		};
		const timer = setTimeout(() => {
			cleanup();
			reject(new Error(`waitForFrames timeout, got: ${JSON.stringify(frames)}`));
		}, timeoutMs);
		ws.addEventListener('message', onMessage);
	});
}

beforeAll(async () => {
	_server = await startDevServer();
	BASE = _server.baseUrl;
	WS_BASE = _server.wsBaseUrl;
}, 30_000);

afterAll(async () => {
	await _server.stop();
}, 30_000);

describe('batch3g: session model is source of truth', () => {
	test('state.model reflects session model for deepseek-chat', async () => {
		const token = await signToken(SECRET);
		const createRes = await fetch(`${BASE}/api/sessions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...authHeader(token) },
			body: JSON.stringify({ title: 'g-deepseek', model: 'deepseek-chat' })
		});
		expect(createRes.status).toBe(201);
		const session = (await createRes.json()) as { id: string; model: string };
		expect(session.model).toBe('deepseek-chat');

		const ws = await wsConnect(session.id, token);
		const frames = await waitForFrames(ws, (f) => f.some((x) => x['t'] === 'state'), 3000);
		const state = frames.find((f) => f['t'] === 'state') as Record<string, unknown>;
		expect(state['model']).toBe('deepseek-chat');
		ws.close();
		await new Promise((r) => setTimeout(r, 200));
	});

	test('state.model reflects session model for openrouter model', async () => {
		const token = await signToken(SECRET);
		const model = 'openai/gpt-4o-mini';
		const createRes = await fetch(`${BASE}/api/sessions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...authHeader(token) },
			body: JSON.stringify({ title: 'g-openrouter', model })
		});
		expect(createRes.status).toBe(201);
		const session = (await createRes.json()) as { id: string; model: string };
		expect(session.model).toBe(model);

		const ws = await wsConnect(session.id, token);
		const frames = await waitForFrames(ws, (f) => f.some((x) => x['t'] === 'state'), 3000);
		const state = frames.find((f) => f['t'] === 'state') as Record<string, unknown>;
		expect(state['model']).toBe(model);
		ws.close();
		await new Promise((r) => setTimeout(r, 200));
	});

	test('send uses session model (stub succeeds for both providers)', async () => {
		// With MODEL_STUB=1, both deepseek and openrouter models succeed — but if the
		// cell hardcoded deepseek-chat, an openrouter session would still call deepseek.
		// We verify by checking state.model and that send completes without err.
		const token = await signToken(SECRET);
		const model = 'openai/gpt-4o-mini';
		const createRes = await fetch(`${BASE}/api/sessions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...authHeader(token) },
			body: JSON.stringify({ title: 'g-send-or', model })
		});
		const session = (await createRes.json()) as { id: string };
		const ws = await wsConnect(session.id, token);
		await waitForFrames(ws, (f) => f.some((x) => x['t'] === 'state'), 3000);

		ws.send(JSON.stringify({ v: 1, t: 'send', text: 'hello from g-send-or' }));
		const frames = await waitForFrames(
			ws,
			(f) => f.some((x) => x['t'] === 'msg' && (x as Record<string, unknown>)['text'] === 'stub response'),
			5000
		);
		const msg = frames.find((f) => f['t'] === 'msg' && (f as Record<string, unknown>)['text'] === 'stub response');
		expect(msg).toBeDefined();
		// No err frame
		expect(frames.some((f) => f['t'] === 'err')).toBe(false);
		ws.close();
		await new Promise((r) => setTimeout(r, 200));
	});

	test('PATCH changes next turn model and state', async () => {
		const token = await signToken(SECRET);
		const createRes = await fetch(`${BASE}/api/sessions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...authHeader(token) },
			body: JSON.stringify({ title: 'g-patch', model: 'deepseek-chat' })
		});
		const session = (await createRes.json()) as { id: string };

		// Connect and verify initial state
		let ws = await wsConnect(session.id, token);
		let frames = await waitForFrames(ws, (f) => f.some((x) => x['t'] === 'state'), 3000);
		let state = frames.find((f) => f['t'] === 'state') as Record<string, unknown>;
		expect(state['model']).toBe('deepseek-chat');
		ws.close();
		await new Promise((r) => setTimeout(r, 300));

		// PATCH to openrouter model
		const patchRes = await fetch(`${BASE}/api/sessions/${encodeURIComponent(session.id)}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json', ...authHeader(token) },
			body: JSON.stringify({ model: 'openai/gpt-4o-mini' })
		});
		expect(patchRes.status).toBe(200);
		const patched = (await patchRes.json()) as { model: string };
		expect(patched.model).toBe('openai/gpt-4o-mini');

		// Reconnect — state should reflect new model
		ws = await wsConnect(session.id, token);
		frames = await waitForFrames(ws, (f) => f.some((x) => x['t'] === 'state'), 3000);
		state = frames.find((f) => f['t'] === 'state') as Record<string, unknown>;
		expect(state['model']).toBe('openai/gpt-4o-mini');

		// Send should succeed with new model
		ws.send(JSON.stringify({ v: 1, t: 'send', text: 'hello after patch' }));
		const afterFrames = await waitForFrames(
			ws,
			(f) => f.some((x) => x['t'] === 'msg' && (x as Record<string, unknown>)['text'] === 'stub response'),
			5000
		);
		expect(afterFrames.some((f) => f['t'] === 'msg' && (f as Record<string, unknown>)['text'] === 'stub response')).toBe(true);
		expect(afterFrames.some((f) => f['t'] === 'err')).toBe(false);
		ws.close();
		await new Promise((r) => setTimeout(r, 200));
	});
});

test('adapter receives session model (echo-model seam)', async () => {
	// This test uses a dedicated server with MODEL_STUB_TEXT=echo-model so the
	// stub echoes the model it received. We verify the echoed model matches the
	// session's model, proving the cell passed the right model to the adapter.
	const { startDevServer: start2 } = await import('./helpers/server');
	const srv = await start2({ modelStubText: 'echo-model' });
	try {
		const token = await signToken(SECRET);
		const model = 'openai/gpt-4o-mini';
		const createRes = await fetch(`${srv.baseUrl}/api/sessions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ title: 'g-echo', model })
		});
		expect(createRes.status).toBe(201);
		const session = (await createRes.json()) as { id: string };
		const ws = await new Promise<WebSocket>((resolve, reject) => {
			const w = new WebSocket(`${srv.wsBaseUrl}/ws?sessionId=${encodeURIComponent(session.id)}&token=${encodeURIComponent(token)}`);
			w.addEventListener('open', () => {
				w.send(JSON.stringify({ v: 1, t: 'hello', sessionId: session.id, token }));
				resolve(w);
			});
			w.addEventListener('error', (e) => reject(e));
			setTimeout(() => reject(new Error('ws timeout')), 5000);
		});
		await waitForFrames(ws, (f) => f.some((x) => x['t'] === 'state'), 3000);
		ws.send(JSON.stringify({ v: 1, t: 'send', text: 'echo please' }));
		const frames = await waitForFrames(
			ws,
			(f) =>
				f.some(
					(x) =>
						x['t'] === 'msg' &&
						typeof (x as Record<string, unknown>)['text'] === 'string' &&
						((x as Record<string, unknown>)['text'] as string).includes('model:')
				),
			8000
		);
		const msg = frames.find(
			(f) =>
				f['t'] === 'msg' &&
				typeof (f as Record<string, unknown>)['text'] === 'string' &&
				((f as Record<string, unknown>)['text'] as string).includes('model:')
		) as Record<string, unknown> | undefined;
		expect(msg).toBeDefined();
		expect(msg!['text']).toBe(`model:${model}`);
		ws.close();
		await new Promise((r) => setTimeout(r, 200));
	} finally {
		await srv.stop();
	}
});

describe('batch3g: default model resolution', () => {
	test('resolveDefaultModel: SUGU_DEFAULT_MODEL wins', () => {
		expect(resolveDefaultModel({ SUGU_DEFAULT_MODEL: 'openai/gpt-4o' })).toBe('openai/gpt-4o');
		expect(resolveDefaultModel({ SUGU_DEFAULT_MODEL: '  deepseek-reasoner  ' })).toBe('deepseek-reasoner');
	});

	test('resolveDefaultModel: fallback is deepseek-chat', () => {
		expect(resolveDefaultModel({})).toBe('deepseek-chat');
		expect(resolveDefaultModel({ SUGU_DEFAULT_MODEL: '' })).toBe('deepseek-chat');
		expect(resolveDefaultModel({ SUGU_DEFAULT_MODEL: '   ' })).toBe('deepseek-chat');
		expect(BUILTIN_DEFAULT_MODEL).toBe('deepseek-chat');
	});

	test('getModels returns defaultModel from SUGU_DEFAULT_MODEL', async () => {
		const { getModels } = await import('../src/server/models');
		const result = await getModels(
			{ SUGU_DEFAULT_MODEL: 'openai/gpt-4o-mini' },
			{
				fetchImpl: (async () => {
					throw new Error('no fetch');
				}) as unknown as typeof fetch,
				cacheImpl: null
			}
		);
		expect(result.defaultModel).toBe('openai/gpt-4o-mini');
		// Even if not in catalogue, still use it
		const result2 = await getModels(
			{ SUGU_DEFAULT_MODEL: 'my/custom-model' },
			{
				fetchImpl: (async () => {
					throw new Error('no fetch');
				}) as unknown as typeof fetch,
				cacheImpl: null
			}
		);
		expect(result2.defaultModel).toBe('my/custom-model');
	});

	test('getModels defaultModel is deepseek-chat when not configured', async () => {
		const { getModels } = await import('../src/server/models');
		const result = await getModels(
			{},
			{
				fetchImpl: (async () => {
					throw new Error('no fetch');
				}) as unknown as typeof fetch,
				cacheImpl: null
			}
		);
		expect(result.defaultModel).toBe('deepseek-chat');
	});

	test('no models[0] fallback: defaultModel never equals first catalogue entry blindly', async () => {
		const { getModels } = await import('../src/server/models');
		// With no SUGU_DEFAULT_MODEL, defaultModel is deepseek-chat regardless of catalogue order
		const result = await getModels(
			{},
			{
				fetchImpl: (async () => {
					throw new Error('no fetch');
				}) as unknown as typeof fetch,
				cacheImpl: null
			}
		);
		expect(result.defaultModel).toBe('deepseek-chat');
		// Catalogue first entry is deepseek-chat in fallback, but that is coincidence — the point is
		// defaultModel comes from resolveDefaultModel, not from models[0]
		expect(result.models[0]!.id).toBe('deepseek-chat');
		// With custom default, it differs from models[0]
		const result2 = await getModels(
			{ SUGU_DEFAULT_MODEL: 'openai/gpt-4o' },
			{
				fetchImpl: (async () => {
					throw new Error('no fetch');
				}) as unknown as typeof fetch,
				cacheImpl: null
			}
		);
		expect(result2.defaultModel).toBe('openai/gpt-4o');
		expect(result2.defaultModel).not.toBe(result2.models[0]!.id);
	});
});

describe('batch3g-fix: pre-3G session recovers model from index', () => {
	test('cell with no stored model adopts index model rather than deepseek-chat', async () => {
		const token = await signToken(SECRET);
		const distinctive = 'openai/gpt-4o-mini';
		const createRes = await fetch(`${BASE}/api/sessions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', ...authHeader(token) },
			body: JSON.stringify({ title: 'g-pre3g', model: distinctive })
		});
		expect(createRes.status).toBe(201);
		const session = (await createRes.json()) as { id: string };

		// Simulate a pre-3G cell: clear its stored model via the test-only seam
		// POST /__test/clear-model { sessionId } (gated by MODEL_STUB, never in prod).
		const clearRes = await fetch(`${BASE}/__test/clear-model`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ sessionId: session.id })
		});
		expect(clearRes.status).toBe(200);
		const cleared = (await clearRes.json()) as { cleared: boolean };
		expect(cleared.cleared).toBe(true);

		// Reconnect: handleHello should recover from MetaCell and report the
		// distinctive model, not the hardcoded fallback.
		const ws = await wsConnect(session.id, token);
		const frames = await waitForFrames(ws, (f) => f.some((x) => x['t'] === 'state'), 4000);
		const state = frames.find((f) => f['t'] === 'state') as Record<string, unknown>;
		expect(state['model']).toBe(distinctive);
		expect(state['model']).not.toBe('deepseek-chat');
		ws.close();
		await new Promise((r) => setTimeout(r, 200));

		// Second reconnect: model is now persisted locally, still distinctive
		const ws2 = await wsConnect(session.id, token);
		const frames2 = await waitForFrames(ws2, (f) => f.some((x) => x['t'] === 'state'), 4000);
		const state2 = frames2.find((f) => f['t'] === 'state') as Record<string, unknown>;
		expect(state2['model']).toBe(distinctive);
		ws2.close();
		await new Promise((r) => setTimeout(r, 200));
	});
});
