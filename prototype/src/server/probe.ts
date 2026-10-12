// Phase-0-only probe endpoints — measure free-tier limits. Delete once numbers are recorded.
// Admin-token only (env.ADMIN_TOKEN), separate from the user HMAC token.

import * as v from 'valibot';
import { errorJson, json } from './http';

const ComputeSchema = v.strictObject({
	iterations: v.number(),
});

const RowsSchema = v.strictObject({
	count: v.number(),
});

export async function handleProbeCompute(request: Request): Promise<Response> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return errorJson('Invalid JSON', 400);
	}
	const parsed = v.safeParse(ComputeSchema, body);
	if (!parsed.success) {
		return errorJson('Invalid body: iterations must be a number', 400);
	}
	const iterations = Math.floor(parsed.output.iterations);
	if (!Number.isFinite(iterations) || iterations < 0 || iterations > 50_000_000) {
		return errorJson('iterations out of range', 400);
	}
	const start = performance.now();
	// Synchronous CPU burn — intentional for quota measurement
	let s = 0;
	for (let i = 0; i < iterations; i++) {
		s += Math.sqrt(i) * Math.sin(i);
	}
	// Prevent dead-code elimination
	if (s === -1) console.log('unreachable');
	const elapsedMs = Math.round(performance.now() - start);
	return json({ iterations, elapsedMs });
}

export async function handleProbeRows(request: Request, env: Env): Promise<Response> {
	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return errorJson('Invalid JSON', 400);
	}
	const parsed = v.safeParse(RowsSchema, body);
	if (!parsed.success) {
		return errorJson('Invalid body: count must be a number', 400);
	}
	const count = Math.floor(parsed.output.count);
	if (!Number.isFinite(count) || count < 0 || count > 10_000) {
		return errorJson('count out of range', 400);
	}
	const stub = env.SESSIONS.getByName('probe') as unknown as { probeWrite: (n: number) => Promise<number> };
	// If the DO exposes probeWrite, use it; otherwise fall back to error
	if (typeof stub.probeWrite === 'function') {
		const written = await stub.probeWrite(count);
		return json({ written });
	}
	// Fallback: try via fetch to a probe endpoint on the DO (if method not available via RPC)
	return errorJson('probeWrite not available', 500);
}
