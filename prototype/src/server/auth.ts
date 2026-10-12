const SEVEN_DAYS_SECONDS = 7 * 24 * 60 * 60;

function b64urlEncode(bytes: Uint8Array): string {
	const b64 = btoa(String.fromCharCode(...bytes));
	return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): Uint8Array {
	const fixed = s.replace(/-/g, '+').replace(/_/g, '/');
	const padded = fixed + '='.repeat((4 - (fixed.length % 4)) % 4);
	return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function b64urlEncodeString(str: string): string {
	return b64urlEncode(new TextEncoder().encode(str));
}

function b64urlDecodeString(s: string): string {
	return new TextDecoder().decode(b64urlDecode(s));
}

async function hmacSign(secret: string, body: string): Promise<string> {
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
	const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body));
	return b64urlEncode(new Uint8Array(sig));
}

async function hmacVerify(secret: string, body: string, sigB64url: string): Promise<boolean> {
	const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
	let sigBytes: Uint8Array;
	try {
		sigBytes = b64urlDecode(sigB64url);
	} catch {
		return false;
	}
	return crypto.subtle.verify('HMAC', key, sigBytes, new TextEncoder().encode(body));
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function signToken(secret: string, now?: number): Promise<string> {
	const i = now !== undefined ? now : Math.floor(Date.now() / 1000);
	const body = { i, exp: i + SEVEN_DAYS_SECONDS };
	const bodyStr = JSON.stringify(body);
	const bodyB64 = b64urlEncodeString(bodyStr);
	const sig = await hmacSign(secret, bodyB64);
	return `${bodyB64}.${sig}`;
}

export type VerifyResult = { ok: true; iat: number } | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export async function verifyToken(token: string, secret: string, now?: number): Promise<VerifyResult> {
	const dot = token.indexOf('.');
	if (dot === -1) return { ok: false, reason: 'malformed' };
	const bodyB64 = token.slice(0, dot);
	const sigB64 = token.slice(dot + 1);
	if (!bodyB64 || !sigB64) return { ok: false, reason: 'malformed' };

	// Verify signature first
	const valid = await hmacVerify(secret, bodyB64, sigB64);
	if (!valid) return { ok: false, reason: 'bad_signature' };

	// Decode body
	let body: { i: number; exp: number };
	try {
		const json = b64urlDecodeString(bodyB64);
		body = JSON.parse(json);
	} catch {
		return { ok: false, reason: 'malformed' };
	}
	if (typeof body.i !== 'number' || typeof body.exp !== 'number') {
		return { ok: false, reason: 'malformed' };
	}

	const nowSec = now !== undefined ? now : Math.floor(Date.now() / 1000);
	if (nowSec >= body.exp) return { ok: false, reason: 'expired' };

	return { ok: true, iat: body.i };
}

export function constantTimeEqual(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) {
		diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	}
	return diff === 0;
}
