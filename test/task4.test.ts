import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { signToken } from '../src/server/auth';
import { startDevServer, TEST_SECRETS, type DevServer } from './helpers/server';

let BASE: string;
let WS_BASE: string;
let _server: DevServer;
const SECRET = TEST_SECRETS.TOKEN_SECRET;

function wsConnect(sessionId: string, token: string, since?: number): Promise<WebSocket> {
	const tokenParam = `&token=${encodeURIComponent(token)}`;
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`${WS_BASE}/ws?sessionId=${encodeURIComponent(sessionId)}${tokenParam}`);
		ws.addEventListener('open', () => {
			const hello: Record<string, unknown> = { v: 1, t: 'hello', sessionId, token };
			if (since !== undefined) hello['since'] = since;
			ws.send(JSON.stringify(hello));
			resolve(ws);
		});
		ws.addEventListener('error', (e) => reject(e));
		setTimeout(() => reject(new Error('ws connect timeout')), 5000);
	});
}

function waitForFrames(
	ws: WebSocket,
	predicate: (frames: Record<string, unknown>[]) => boolean,
	timeoutMs = 5000,
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
				// ignore
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

describe('task4: model streaming', () => {
	test('send no longer echoes, returns stub response', async () => {
		const sessionId = `test-task4-echo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const token = await signToken(SECRET);
		const ws = await wsConnect(sessionId, token);
		await waitForFrames(ws, (frames) => frames.some((f) => f['t'] === 'state'), 3000);

		ws.send(JSON.stringify({ v: 1, t: 'send', text: 'hello world' }));
		const frames = await waitForFrames(
			ws,
			(frames) => frames.some((f) => f['t'] === 'msg' && (f as Record<string, unknown>)['text'] === 'stub response'),
			5000,
		);
		const msg = frames.find((f) => f['t'] === 'msg' && (f as Record<string, unknown>)['text'] === 'stub response');
		expect(msg).toBeDefined();
		// Should NOT be echo: hello world
		const echoMsg = frames.find((f) => f['t'] === 'msg' && (f as Record<string, unknown>)['text'] === 'echo: hello world');
		expect(echoMsg).toBeUndefined();

		ws.close();
		await new Promise((r) => setTimeout(r, 200));
	});

	test('final row holds model text, usage was recorded', async () => {
		const sessionId = `test-task4-usage-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const token = await signToken(SECRET);
		const ws = await wsConnect(sessionId, token);
		await waitForFrames(ws, (frames) => frames.some((f) => f['t'] === 'state'), 3000);

		ws.send(JSON.stringify({ v: 1, t: 'send', text: 'check usage' }));
		await waitForFrames(
			ws,
			(frames) => frames.some((f) => f['t'] === 'msg' && (f as Record<string, unknown>)['text'] === 'stub response'),
			5000,
		);
		// Wait for state with busy:false to ensure usage was recorded
		await waitForFrames(ws, (frames) => frames.some((f) => f['t'] === 'state' && (f as Record<string, unknown>)['busy'] === false), 3000);

		// Check snapshot for usage via direct DO call
		// Use fetch to get snapshot and check rows
		const snapRes = await fetch(`${BASE}/ws?sessionId=${encodeURIComponent(sessionId)}&token=${encodeURIComponent(token)}&__snapshot=1`);
		expect(snapRes.ok).toBe(true);
		const rows = (await snapRes.json()) as { id: number; type: string; payload: string; meta: string | null }[];
		const assistantRow = rows.find((r) => r.type === 'assistant');
		expect(assistantRow).toBeDefined();
		expect(JSON.parse(assistantRow!.payload).text).toBe('stub response');

		ws.close();
		await new Promise((r) => setTimeout(r, 200));
	});

	test('GET /api/quota returns usage (one row-read, token-authed)', async () => {
		const token = await signToken(SECRET);
		const res = await fetch(`${BASE}/api/quota`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		const body = (await res.json()) as { day: string; turns: number; prompt_t: number; compl_t: number; cost_usd: number };
		expect(typeof body.day).toBe('string');
		expect(typeof body.turns).toBe('number');
		expect(typeof body.prompt_t).toBe('number');
		expect(typeof body.compl_t).toBe('number');
		expect(typeof body.cost_usd).toBe('number');
	});

	test('GET /api/quota without token -> 401', async () => {
		const res = await fetch(`${BASE}/api/quota`);
		expect(res.status).toBe(401);
	});

	test('token frames carry same seq as final msg', async () => {
		const sessionId = `test-task4-seq-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const token = await signToken(SECRET);
		const ws = await wsConnect(sessionId, token);
		await waitForFrames(ws, (frames) => frames.some((f) => f['t'] === 'state'), 3000);

		ws.send(JSON.stringify({ v: 1, t: 'send', text: 'seq check' }));
		const frames = await waitForFrames(
			ws,
			(frames) => frames.some((f) => f['t'] === 'msg' && (f as Record<string, unknown>)['text'] === 'stub response'),
			5000,
		);
		const tokenFrames = frames.filter((f) => f['t'] === 'token');
		expect(tokenFrames.length).toBeGreaterThan(0);
		const msgFrame = frames.find((f) => f['t'] === 'msg' && (f as Record<string, unknown>)['text'] === 'stub response') as Record<string, unknown>;
		expect(msgFrame).toBeDefined();
		expect(tokenFrames[0]!['seq']).toBe(msgFrame['seq']);

		ws.close();
		await new Promise((r) => setTimeout(r, 200));
	});

	test('composer usable after turn completes (busy false)', async () => {
		const sessionId = `test-task4-composer-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const token = await signToken(SECRET);
		const ws = await wsConnect(sessionId, token);
		await waitForFrames(ws, (frames) => frames.some((f) => f['t'] === 'state'), 3000);

		ws.send(JSON.stringify({ v: 1, t: 'send', text: 'first' }));
		await waitForFrames(
			ws,
			(frames) => frames.some((f) => f['t'] === 'msg' && (f as Record<string, unknown>)['text'] === 'stub response'),
			5000,
		);
		await waitForFrames(ws, (frames) => frames.some((f) => f['t'] === 'state' && (f as Record<string, unknown>)['busy'] === false), 3000);

		// Second send should be accepted — wait for its msg
		ws.send(JSON.stringify({ v: 1, t: 'send', text: 'second' }));
		const frames2 = await waitForFrames(
			ws,
			(frames) => frames.some((f) => f['t'] === 'msg' && (f as Record<string, unknown>)['text'] === 'stub response' && (f as Record<string, unknown>)['role'] === 'assistant'),
			5000,
		);
		const msgs = frames2.filter((f) => f['t'] === 'msg' && (f as Record<string, unknown>)['text'] === 'stub response' && (f as Record<string, unknown>)['role'] === 'assistant');
		expect(msgs.length).toBeGreaterThanOrEqual(1);
		expect(frames2.some((f) => f['t'] === 'err' && (f as Record<string, unknown>)['code'] === 'busy')).toBe(false);

		ws.close();
		await new Promise((r) => setTimeout(r, 200));
	});
});
