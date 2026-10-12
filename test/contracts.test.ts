import { describe, test, expect } from 'bun:test';
import * as v from 'valibot';
import { parseFrame, Frame, PROTOCOL_VERSION } from '../src/shared/contracts';

describe('contracts', () => {
	test('PROTOCOL_VERSION is 1', () => {
		expect(PROTOCOL_VERSION).toBe(1);
	});

	// Every variant round-trips
	test('hello round-trips', () => {
		const raw = { v: 1, t: 'hello', sessionId: 'abc', token: 'tok' };
		const r = parseFrame(raw);
		expect(r.ok).toBe(true);
		if (r.ok) expect(r.frame.t).toBe('hello');
	});

	test('hello with since round-trips', () => {
		const raw = { v: 1, t: 'hello', sessionId: 'abc', token: 'tok', since: 5 };
		const r = parseFrame(raw);
		expect(r.ok).toBe(true);
	});

	test('send round-trips', () => {
		const raw = { v: 1, t: 'send', text: 'hi' };
		expect(parseFrame(raw).ok).toBe(true);
	});

	test('send with skills round-trips', () => {
		const raw = { v: 1, t: 'send', text: 'hi', skills: ['a', 'b'] };
		expect(parseFrame(raw).ok).toBe(true);
	});

	test('cancel round-trips', () => {
		expect(parseFrame({ v: 1, t: 'cancel' }).ok).toBe(true);
	});

	test('approve round-trips', () => {
		expect(parseFrame({ v: 1, t: 'approve', runId: 'r1' }).ok).toBe(true);
	});

	test('ack round-trips', () => {
		expect(parseFrame({ v: 1, t: 'ack', seq: 1, to: 2 }).ok).toBe(true);
	});

	test('token round-trips', () => {
		expect(parseFrame({ v: 1, t: 'token', seq: 1, delta: 'hi' }).ok).toBe(true);
	});

	test('msg round-trips', () => {
		expect(parseFrame({ v: 1, t: 'msg', seq: 1, id: 1, role: 'user', text: 'hi' }).ok).toBe(true);
	});

	test('msg with interrupted round-trips', () => {
		expect(parseFrame({ v: 1, t: 'msg', seq: 1, id: 1, role: 'assistant', text: 'hi', interrupted: true }).ok).toBe(true);
	});

	test('tool round-trips', () => {
		expect(parseFrame({ v: 1, t: 'tool', seq: 1, runId: 'r1', name: 'read', status: 'running' }).ok).toBe(true);
	});

	test('state round-trips', () => {
		expect(parseFrame({ v: 1, t: 'state', seq: 1, todos: [], busy: false, model: 'deepseek-chat' }).ok).toBe(true);
	});

	test('err round-trips', () => {
		expect(parseFrame({ v: 1, t: 'err', code: 'auth', message: 'bad' }).ok).toBe(true);
	});

	// Rejections
	test('v:2 is rejected', () => {
		const r = parseFrame({ v: 2, t: 'hello', sessionId: 'x', token: 'y' });
		expect(r.ok).toBe(false);
	});

	test('unknown t is rejected', () => {
		const r = parseFrame({ v: 1, t: 'unknown_thing' });
		expect(r.ok).toBe(false);
	});

	test('send with no text is rejected', () => {
		const r = parseFrame({ v: 1, t: 'send' });
		expect(r.ok).toBe(false);
	});

	test('err carrying seq is rejected', () => {
		const r = parseFrame({ v: 1, t: 'err', code: 'auth', message: 'x', seq: 1 });
		expect(r.ok).toBe(false);
	});

	test('hello carrying seq is rejected', () => {
		const r = parseFrame({ v: 1, t: 'hello', sessionId: 'x', token: 'y', seq: 1 });
		expect(r.ok).toBe(false);
	});

	test('unknown extra key on hello is rejected', () => {
		const r = parseFrame({ v: 1, t: 'hello', sessionId: 'x', token: 'y', extra: 'bad' });
		expect(r.ok).toBe(false);
	});

	test('unknown extra key on send is rejected', () => {
		const r = parseFrame({ v: 1, t: 'send', text: 'hi', extra: 'bad' });
		expect(r.ok).toBe(false);
	});

	test('parseFrame does not throw on garbage', () => {
		expect(() => parseFrame(null)).not.toThrow();
		expect(() => parseFrame(undefined)).not.toThrow();
		expect(() => parseFrame('hello')).not.toThrow();
		expect(() => parseFrame(42)).not.toThrow();
		expect(parseFrame(null).ok).toBe(false);
	});

	test('Frame type is usable via valibot parse', () => {
		const raw = { v: 1, t: 'send', text: 'hello' };
		const parsed = v.parse(Frame, raw);
		expect(parsed.t).toBe('send');
	});
});
