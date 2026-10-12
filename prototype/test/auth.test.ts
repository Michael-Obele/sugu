import { describe, test, expect } from 'bun:test';
import { signToken, verifyToken, constantTimeEqual } from '../src/server/auth';

describe('auth', () => {
	test('freshly signed token verifies', async () => {
		const secret = 'test-secret-123';
		const now = 1_000_000;
		const token = await signToken(secret, now);
		const result = await verifyToken(token, secret, now + 100);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.iat).toBe(now);
	});

	test('tampered body fails with bad_signature', async () => {
		const secret = 'test-secret-123';
		const now = 1_000_000;
		const token = await signToken(secret, now);
		const dot = token.indexOf('.');
		const body = token.slice(0, dot);
		const sig = token.slice(dot + 1);
		// Flip a char in body
		const tamperedBody = body.slice(0, -2) + (body.slice(-2, -1) === 'A' ? 'B' : 'A') + body.slice(-1);
		const tampered = `${tamperedBody}.${sig}`;
		const result = await verifyToken(tampered, secret, now + 100);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('bad_signature');
	});

	test('tampered signature fails with bad_signature', async () => {
		const secret = 'test-secret-123';
		const now = 1_000_000;
		const token = await signToken(secret, now);
		const dot = token.indexOf('.');
		const body = token.slice(0, dot);
		const sig = token.slice(dot + 1);
		const tamperedSig = sig.slice(0, -2) + (sig.slice(-2, -1) === 'A' ? 'B' : 'A') + sig.slice(-1);
		const tampered = `${body}.${tamperedSig}`;
		const result = await verifyToken(tampered, secret, now + 100);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('bad_signature');
	});

	test('expired token fails as expired', async () => {
		const secret = 'test-secret-123';
		const now = 1_000_000;
		const token = await signToken(secret, now);
		// 7 days = 604800 seconds, so now + 604801 should be expired
		const result = await verifyToken(token, secret, now + 604801);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('expired');
	});

	test('token not yet expired at boundary', async () => {
		const secret = 'test-secret-123';
		const now = 1_000_000;
		const token = await signToken(secret, now);
		const result = await verifyToken(token, secret, now + 604799);
		expect(result.ok).toBe(true);
	});

	test('wrong secret fails with bad_signature', async () => {
		const secret = 'test-secret-123';
		const now = 1_000_000;
		const token = await signToken(secret, now);
		const result = await verifyToken(token, 'wrong-secret', now + 100);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('bad_signature');
	});

	test('malformed token without dot fails', async () => {
		const result = await verifyToken('not-a-valid-token', 'secret', 1000);
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.reason).toBe('malformed');
	});

	test('constantTimeEqual true for equal strings', () => {
		expect(constantTimeEqual('hello', 'hello')).toBe(true);
		expect(constantTimeEqual('', '')).toBe(true);
		expect(constantTimeEqual('a', 'a')).toBe(true);
	});

	test('constantTimeEqual false for different strings', () => {
		expect(constantTimeEqual('hello', 'world')).toBe(false);
		expect(constantTimeEqual('hello', 'hella')).toBe(false);
		expect(constantTimeEqual('hello', 'hello!')).toBe(false);
		expect(constantTimeEqual('', 'a')).toBe(false);
	});
});
