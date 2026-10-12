import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { startDevServer, type DevServer } from './helpers/server';
import { signToken } from '../src/server/auth';

// Each login test uses its own cf-connecting-ip so buckets are deterministic and isolated.
function loginHeaders(ip: string): Record<string, string> {
	return { 'content-type': 'application/json', 'cf-connecting-ip': ip };
}

let server: DevServer;
let BASE: string;
let WS_BASE: string;

const SECRET = '4f0a1aa91ca3c4b6ff366f4d88d58c6348195877c4023149';
const ADMIN = '16e9a1696278265e7d30700ceeb40ea16e3c32794e8507ce';
const PASSPHRASE = 'dev-passphrase';

beforeAll(async () => {
	server = await startDevServer();
	BASE = server.baseUrl;
	WS_BASE = server.wsBaseUrl;
});

afterAll(async () => {
	await server.stop();
});

describe('worker edge', () => {
	test('GET /api/health -> 200 and two pongs', async () => {
		const res = await fetch(`${BASE}/api/health`);
		expect(res.status).toBe(200);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.ok).toBe(true);
		expect(body.meta).toBe('pong');
		expect(body.session).toBe('pong');
	});

	test('POST /api/login with wrong passphrase -> 401', async () => {
		const res = await fetch(`${BASE}/api/login`, {
			method: 'POST',
			headers: loginHeaders('10.0.0.1'),
			body: JSON.stringify({ passphrase: 'wrong' }),
		});
		expect(res.status).toBe(401);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.error).toBeDefined();
	});

	test('POST /api/login with correct passphrase -> token that works on GET /api/sessions', async () => {
		const loginRes = await fetch(`${BASE}/api/login`, {
			method: 'POST',
			headers: loginHeaders('10.0.0.2'),
			body: JSON.stringify({ passphrase: PASSPHRASE }),
		});
		expect(loginRes.status).toBe(200);
		const loginBody = (await loginRes.json()) as { token: string };
		expect(typeof loginBody.token).toBe('string');
		expect(loginBody.token.length).toBeGreaterThan(10);

		const sessionsRes = await fetch(`${BASE}/api/sessions`, {
			headers: { Authorization: `Bearer ${loginBody.token}` },
		});
		expect(sessionsRes.status).toBe(200);
		const sessions = await sessionsRes.json();
		expect(Array.isArray(sessions)).toBe(true);
	});

	test('GET /api/sessions with no token -> 401', async () => {
		const res = await fetch(`${BASE}/api/sessions`);
		expect(res.status).toBe(401);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.error).toBeDefined();
	});

	test('GET /api/sessions with valid token -> array', async () => {
		const token = await signToken(SECRET);
		const res = await fetch(`${BASE}/api/sessions`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(res.status).toBe(200);
		const body = await res.json();
		expect(Array.isArray(body)).toBe(true);
	});

	test('POST /api/sessions then GET -> new session appears first', async () => {
		const token = await signToken(SECRET);
		const title = `test-session-${Date.now()}`;
		const createRes = await fetch(`${BASE}/api/sessions`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ title }),
		});
		expect(createRes.status).toBe(201);
		const created = (await createRes.json()) as { id: string; title: string };
		expect(created.title).toBe(title);

		const listRes = await fetch(`${BASE}/api/sessions`, {
			headers: { Authorization: `Bearer ${token}` },
		});
		expect(listRes.status).toBe(200);
		const list = (await listRes.json()) as { id: string }[];
		expect(list.length).toBeGreaterThan(0);
		expect(list[0]!.id).toBe(created.id);
	});

	test('GET /ws with no token -> 401 and DO never touched', async () => {
		const res = await fetch(`${BASE}/ws?sessionId=test-no-token-${Date.now()}`, {
			headers: { Upgrade: 'websocket' },
		});
		// Worker should reject before proxying — 401 JSON, not 101 or 426
		expect(res.status).toBe(401);
		const body = (await res.json()) as Record<string, unknown>;
		expect(body.error).toBeDefined();
	});

	test('probe endpoints without admin token -> 401', async () => {
		const userToken = await signToken(SECRET);
		for (const path of ['/api/probe/compute', '/api/probe/rows']) {
			const res = await fetch(`${BASE}${path}`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', Authorization: `Bearer ${userToken}` },
				body: JSON.stringify(path.includes('compute') ? { iterations: 100 } : { count: 10 }),
			});
			expect(res.status).toBe(401);
		}
		// Also without any token
		const res2 = await fetch(`${BASE}/api/probe/compute`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ iterations: 100 }),
		});
		expect(res2.status).toBe(401);
	});

	test('probe endpoints with admin token -> 200', async () => {
		const computeRes = await fetch(`${BASE}/api/probe/compute`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', Authorization: `Bearer ${ADMIN}` },
			body: JSON.stringify({ iterations: 1000 }),
		});
		expect(computeRes.status).toBe(200);
		const computeBody = (await computeRes.json()) as { iterations: number; elapsedMs: number };
		expect(computeBody.iterations).toBe(1000);
		expect(typeof computeBody.elapsedMs).toBe('number');

		const rowsRes = await fetch(`${BASE}/api/probe/rows`, {
			method: 'POST',
			headers: { 'content-type': 'application/json', Authorization: `Bearer ${ADMIN}` },
			body: JSON.stringify({ count: 5 }),
		});
		expect(rowsRes.status).toBe(200);
		const rowsBody = (await rowsRes.json()) as { written: number };
		expect(rowsBody.written).toBe(5);
	});

	test('unauthenticated ?__snapshot=1 is rejected before DO', async () => {
		const sessionId = `test-snapshot-auth-${Date.now()}`;
		const res = await fetch(`${BASE}/ws?sessionId=${encodeURIComponent(sessionId)}&__snapshot=1`);
		// Should be rejected at Worker auth gate — 401, not 200 with rows
		// Note: __snapshot is handled inside SessionCell.fetch, but Worker /ws gate should run first.
		// For non-websocket snapshot requests without token, the Worker currently only gates /ws websocket upgrades.
		// If the Worker gates all /ws paths, this will be 401. Otherwise it may reach the DO.
		// The brief says: "An unauthenticated ?__snapshot=1 request is rejected, which proves the auth gate runs before the DO is ever touched."
		// So we expect 401 here.
		expect(res.status).toBe(401);
	});

	test('deep path /sessions/abc still returns SPA index.html (200)', async () => {
		const res = await fetch(`${BASE}/sessions/abc`);
		expect(res.status).toBe(200);
		const text = await res.text();
		expect(text).toContain('<!doctype html');
	});

	test('login throttle: 5 failed attempts then 6th returns 429 (only failures count)', async () => {
		const throttleIp = `10.9.9.${Date.now() % 250}`;
		for (let i = 0; i < 5; i++) {
			const res = await fetch(`${BASE}/api/login`, {
				method: 'POST',
				headers: loginHeaders(throttleIp),
				body: JSON.stringify({ passphrase: 'wrong-throttle' }),
			});
			expect(res.status).toBe(401);
		}
		const sixth = await fetch(`${BASE}/api/login`, {
			method: 'POST',
			headers: loginHeaders(throttleIp),
			body: JSON.stringify({ passphrase: 'wrong-throttle' }),
		});
		expect(sixth.status).toBe(429);
		const body = (await sixth.json()) as Record<string, unknown>;
		expect(body.error).toBeDefined();
	});
});
