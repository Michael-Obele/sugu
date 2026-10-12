import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { signToken } from '../src/server/auth';

const BASE = 'http://127.0.0.1:8787';
const WS_BASE = 'ws://127.0.0.1:8787';
const SECRET = '4f0a1aa91ca3c4b6ff366f4d88d58c6348195877c4023149';

function wsConnect(sessionId: string, token: string, since?: number): Promise<WebSocket> {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(`${WS_BASE}/ws?sessionId=${encodeURIComponent(sessionId)}`);
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

function collectFrames(ws: WebSocket, timeoutMs = 3000): Promise<Record<string, unknown>[]> {
	const frames: Record<string, unknown>[] = [];
	return new Promise((resolve) => {
		const onMessage = (event: MessageEvent) => {
			try {
				frames.push(JSON.parse(event.data as string));
			} catch {
				// ignore
			}
		};
		ws.addEventListener('message', onMessage);
		setTimeout(() => {
			ws.removeEventListener('message', onMessage);
			resolve(frames);
		}, timeoutMs);
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

let healthOk = false;

beforeAll(async () => {
	// Verify wrangler dev is up
	for (let i = 0; i < 10; i++) {
		try {
			const res = await fetch(`${BASE}/api/health`);
			if (res.ok) {
				healthOk = true;
				break;
			}
		} catch {
			// retry
		}
		await new Promise((r) => setTimeout(r, 500));
	}
	if (!healthOk) throw new Error('wrangler dev not reachable at ' + BASE);
});

describe('session-cell integration', () => {
	test('hello -> send ping -> token frames and final msg with matching seq', async () => {
		const sessionId = `test-echo-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const token = await signToken(SECRET);
		const ws = await wsConnect(sessionId, token);

		// Wait for initial state
		const initial = await waitForFrames(ws, (frames) => frames.some((f) => f['t'] === 'state'), 3000);
		expect(initial.some((f) => f['t'] === 'state')).toBe(true);

		// Send ping
		ws.send(JSON.stringify({ v: 1, t: 'send', text: 'ping' }));

		const frames = await waitForFrames(
			ws,
			(frames) => frames.some((f) => f['t'] === 'msg' && (f as Record<string, unknown>)['text'] === 'echo: ping'),
			5000,
		);

		const tokenFrames = frames.filter((f) => f['t'] === 'token');
		expect(tokenFrames.length).toBeGreaterThan(0);

		const msgFrame = frames.find((f) => f['t'] === 'msg' && (f as Record<string, unknown>)['text'] === 'echo: ping') as
			Record<string, unknown> | undefined;
		expect(msgFrame).toBeDefined();
		// Token seq should match final msg seq
		const tokenSeq = tokenFrames[0]!['seq'];
		expect(msgFrame!['seq']).toBe(tokenSeq);

		ws.close();
		await new Promise((r) => setTimeout(r, 200));
	});

	test('resume: hello with since replays only messages after seq', async () => {
		const sessionId = `test-resume-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const token = await signToken(SECRET);

		// First connection: send two messages
		const ws1 = await wsConnect(sessionId, token);
		await waitForFrames(ws1, (frames) => frames.some((f) => f['t'] === 'state'), 3000);

		ws1.send(JSON.stringify({ v: 1, t: 'send', text: 'first' }));
		const frames1 = await waitForFrames(
			ws1,
			(frames) => frames.some((f) => f['t'] === 'msg' && (f as Record<string, unknown>)['text'] === 'echo: first'),
			5000,
		);
		const firstMsg = frames1.find((f) => f['t'] === 'msg' && (f as Record<string, unknown>)['text'] === 'echo: first') as Record<
			string,
			unknown
		>;
		const firstSeq = firstMsg['seq'] as number;

		ws1.send(JSON.stringify({ v: 1, t: 'send', text: 'second' }));
		const frames2 = await waitForFrames(
			ws1,
			(frames) => frames.some((f) => f['t'] === 'msg' && (f as Record<string, unknown>)['text'] === 'echo: second'),
			5000,
		);
		// Collect all frames from second send (need to track from after first)
		ws1.close();
		await new Promise((r) => setTimeout(r, 300));

		// Reconnect with since = firstSeq
		const ws2 = await wsConnect(sessionId, token, firstSeq);
		const replayFrames = await waitForFrames(ws2, (frames) => frames.some((f) => f['t'] === 'state'), 3000);

		// Should contain second message but not first
		const replayMsgs = replayFrames.filter((f) => f['t'] === 'msg') as Record<string, unknown>[];
		const hasFirst = replayMsgs.some((f) => f['text'] === 'first' || f['text'] === 'echo: first');
		const hasSecond = replayMsgs.some((f) => f['text'] === 'echo: second');

		expect(hasFirst).toBe(false);
		expect(hasSecond).toBe(true);

		ws2.close();
		await new Promise((r) => setTimeout(r, 200));
	});

	test('busy: second send while busy gets err busy', async () => {
		const sessionId = `test-busy-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const token = await signToken(SECRET);
		const ws = await wsConnect(sessionId, token);
		await waitForFrames(ws, (frames) => frames.some((f) => f['t'] === 'state'), 3000);

		// Send first message and immediately send second
		ws.send(JSON.stringify({ v: 1, t: 'send', text: 'x'.repeat(200) }));
		await new Promise((r) => setTimeout(r, 10));
		ws.send(JSON.stringify({ v: 1, t: 'send', text: 'second-busy' }));

		const frames = await waitForFrames(
			ws,
			(frames) => frames.some((f) => f['t'] === 'err' && (f as Record<string, unknown>)['code'] === 'busy'),
			5000,
		);
		const busyErr = frames.find((f) => f['t'] === 'err' && (f as Record<string, unknown>)['code'] === 'busy');
		expect(busyErr).toBeDefined();

		// Wait for first turn to complete
		await waitForFrames(
			ws,
			(frames) =>
				frames.some(
					(f) =>
						f['t'] === 'msg' &&
						typeof (f as Record<string, unknown>)['text'] === 'string' &&
						((f as Record<string, unknown>)['text'] as string).startsWith('echo: x'),
				),
			5000,
		);

		ws.close();
		await new Promise((r) => setTimeout(r, 200));
	});

	test('cancel mid-stream persists interrupted', async () => {
		const sessionId = `test-cancel-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const token = await signToken(SECRET);
		const ws = await wsConnect(sessionId, token);
		await waitForFrames(ws, (frames) => frames.some((f) => f['t'] === 'state'), 3000);

		// Send a longer message to have time to cancel
		ws.send(JSON.stringify({ v: 1, t: 'send', text: 'a'.repeat(200) }));
		await new Promise((r) => setTimeout(r, 15));
		ws.send(JSON.stringify({ v: 1, t: 'cancel' }));

		const frames = await waitForFrames(
			ws,
			(frames) => frames.some((f) => f['t'] === 'msg' && (f as Record<string, unknown>)['interrupted'] === true),
			5000,
		);
		const interrupted = frames.find((f) => f['t'] === 'msg' && (f as Record<string, unknown>)['interrupted'] === true);
		expect(interrupted).toBeDefined();

		ws.close();
		await new Promise((r) => setTimeout(r, 200));
	});

	test('reservation exists before turn completes and is updated after', async () => {
		const sessionId = `test-reserve-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const token = await signToken(SECRET);
		const ws = await wsConnect(sessionId, token);
		await waitForFrames(ws, (frames) => frames.some((f) => f['t'] === 'state'), 3000);

		// Send a long message so the turn takes a moment (many 8-char chunks * 5ms each)
		ws.send(JSON.stringify({ v: 1, t: 'send', text: 'b'.repeat(200) }));
		// Wait for first token frame — proves the turn started and reservation is durable
		await waitForFrames(ws, (frames) => frames.some((f) => f['t'] === 'token'), 3000);

		// Read snapshot via HTTP without waiting for stream to finish — goes through
		// worker's /ws proxy to the same SessionCell (same sessionId → same DO)
		const snapRes = await fetch(`${BASE}/ws?sessionId=${encodeURIComponent(sessionId)}&__snapshot=1`);
		expect(snapRes.ok).toBe(true);
		const rows = (await snapRes.json()) as { id: number; type: string; role: string | null; payload: string; meta: string | null }[];
		// Should have user row + reserved assistant row (interrupted:true) even though turn not done
		expect(rows.length).toBe(2);
		expect(rows[0]!.type).toBe('user');
		expect(rows[1]!.type).toBe('assistant');
		const meta1 = rows[1]!.meta ? JSON.parse(rows[1]!.meta) : {};
		expect(meta1.interrupted).toBe(true);

		// Wait for turn to complete
		await waitForFrames(
			ws,
			(frames) =>
				frames.some(
					(f) =>
						f['t'] === 'msg' &&
						typeof (f as Record<string, unknown>)['text'] === 'string' &&
						((f as Record<string, unknown>)['text'] as string).startsWith('echo: b'),
				),
			5000,
		);

		// After completion, the same row should be updated to interrupted:false with final text
		const snapRes2 = await fetch(`${BASE}/ws?sessionId=${encodeURIComponent(sessionId)}&__snapshot=1`);
		expect(snapRes2.ok).toBe(true);
		const rows2 = (await snapRes2.json()) as { id: number; type: string; role: string | null; payload: string; meta: string | null }[];
		expect(rows2.length).toBe(2);
		expect(rows2[1]!.id).toBe(rows[1]!.id); // same row, updated
		expect(JSON.parse(rows2[1]!.payload).text).toBe('echo: ' + 'b'.repeat(200));
		const meta2 = rows2[1]!.meta ? JSON.parse(rows2[1]!.meta) : {};
		expect(meta2.interrupted).toBe(false);

		ws.close();
		await new Promise((r) => setTimeout(r, 200));
	});

	test('hello with bad token gets err auth and close 1008', async () => {
		const sessionId = `test-auth-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const badToken = await signToken('wrong-secret');

		const ws = new WebSocket(`${WS_BASE}/ws`);
		let errFrame: Record<string, unknown> | null = null;
		let closeCode: number | null = null;

		await new Promise<void>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error('auth test timeout')), 5000);
			ws.addEventListener('open', () => {
				ws.send(JSON.stringify({ v: 1, t: 'hello', sessionId, token: badToken }));
			});
			ws.addEventListener('message', (event) => {
				try {
					const frame = JSON.parse(event.data as string);
					if (frame.t === 'err' && frame.code === 'auth') {
						errFrame = frame;
					}
				} catch {
					// ignore
				}
			});
			ws.addEventListener('close', (event) => {
				closeCode = event.code;
				clearTimeout(timer);
				resolve();
			});
			ws.addEventListener('error', () => {
				// close may follow error
			});
		});

		expect(errFrame).not.toBeNull();
		expect((errFrame as unknown as Record<string, unknown>)!['code']).toBe('auth');
		expect(closeCode as unknown as number).toBe(1008);
	});
});
