import { describe, test, expect } from 'bun:test';
import { applyFrame, initialFrameState, type FrameState } from '../sugu/src/lib/frames';
import { parseFrame } from '../src/shared/contracts';
import type { Frame } from '../src/shared/contracts';

function token(seq: number, delta: string): Frame {
	return { v: 1, t: 'token', seq, delta } as Frame;
}

function msg(seq: number, text: string, opts?: { interrupted?: boolean }): Frame {
	return {
		v: 1,
		t: 'msg',
		seq,
		id: seq,
		role: 'assistant',
		text,
		...(opts?.interrupted ? { interrupted: true } : {})
	} as Frame;
}

function userMsg(seq: number, text: string): Frame {
	return { v: 1, t: 'msg', seq, id: seq, role: 'user', text } as Frame;
}

describe('frames', () => {
	test('tokens append to the bubble for their seq', () => {
		let state = initialFrameState();
		state = applyFrame(state, token(1, 'hel'));
		expect(state.messages.length).toBe(1);
		expect(state.messages[0]!.text).toBe('hel');
		expect(state.messages[0]!.streaming).toBe(true);

		state = applyFrame(state, token(1, 'lo'));
		expect(state.messages.length).toBe(1);
		expect(state.messages[0]!.text).toBe('hello');
	});

	test('persisted msg for that seq replaces the live text', () => {
		let state = initialFrameState();
		state = applyFrame(state, token(5, 'streaming text'));
		expect(state.messages[0]!.text).toBe('streaming text');
		expect(state.messages[0]!.streaming).toBe(true);

		state = applyFrame(state, msg(5, 'final text'));
		expect(state.messages.length).toBe(1);
		expect(state.messages[0]!.text).toBe('final text');
		expect(state.messages[0]!.streaming).toBe(false);
	});

	test('replayed frame for a seq you already have is not duplicated', () => {
		let state = initialFrameState();
		state = applyFrame(state, msg(1, 'hello'));
		expect(state.messages.length).toBe(1);

		// Replay same seq with same text - should replace, not duplicate
		state = applyFrame(state, msg(1, 'hello'));
		expect(state.messages.length).toBe(1);
		expect(state.messages[0]!.text).toBe('hello');

		// Replay with different text - should replace
		state = applyFrame(state, msg(1, 'updated'));
		expect(state.messages.length).toBe(1);
		expect(state.messages[0]!.text).toBe('updated');
	});

	test('out-of-order frame is placed by seq, not by arrival', () => {
		let state = initialFrameState();
		state = applyFrame(state, msg(3, 'third'));
		state = applyFrame(state, msg(1, 'first'));
		state = applyFrame(state, msg(2, 'second'));

		expect(state.messages.length).toBe(3);
		expect(state.messages[0]!.seq).toBe(1);
		expect(state.messages[0]!.text).toBe('first');
		expect(state.messages[1]!.seq).toBe(2);
		expect(state.messages[1]!.text).toBe('second');
		expect(state.messages[2]!.seq).toBe(3);
		expect(state.messages[2]!.text).toBe('third');
	});

	test('unknown/invalid frame is ignored rather than thrown (real boundary: parseFrame → applyFrame)', () => {
		let state = initialFrameState();
		state = applyFrame(state, msg(1, 'hello'));
		expect(state.messages.length).toBe(1);

		// Unknown t via real boundary: JSON.parse → parseFrame → applyFrame
		// parseFrame rejects unknown t, so we simulate the socket's error path:
		// on parse failure we do NOT call applyFrame and do NOT mutate state.
		// But if a frame somehow reaches applyFrame with an unknown t, it must
		// increment ignoredCount and not throw.
		const unknownRaw = JSON.parse(JSON.stringify({ v: 1, t: 'unknown_frame', seq: 99 }));
		const parsed = parseFrame(unknownRaw);
		expect(parsed.ok).toBe(false);
		// Socket would surface via onError and not call applyFrame — state unchanged
		expect(state.messages.length).toBe(1);
		expect(state.ignoredCount).toBe(0);

		// Directly test applyFrame's default branch with an unknown frame
		// (cast to Frame to exercise the boundary)
		const before = state.messages.length;
		state = applyFrame(state, { v: 1, t: 'unknown_frame', seq: 99 } as unknown as Frame);
		expect(state.messages.length).toBe(before);
		expect(state.ignoredCount).toBe(1);

		// Invalid envelope (wrong version) — parseFrame rejects
		const badVersion = JSON.parse(JSON.stringify({ v: 2, t: 'msg', seq: 1, id: 1, role: 'assistant', text: 'hi' }));
		const parsed2 = parseFrame(badVersion);
		expect(parsed2.ok).toBe(false);
		expect(state.ignoredCount).toBe(1);

		// Null/invalid JSON — JSON.parse would throw, socket catches and surfaces via onError
		let threw = false;
		try {
			JSON.parse('not json');
		} catch {
			threw = true;
		}
		expect(threw).toBe(true);
		expect(state.ignoredCount).toBe(1);

		// Original messages still intact
		expect(state.messages.length).toBe(1);
		expect(state.messages[0]!.text).toBe('hello');

		// Unknown frame via applyFrame with valid envelope but unexpected t
		state = applyFrame(state, { v: 1, t: 'bogus', seq: 2 } as unknown as Frame);
		expect(state.ignoredCount).toBe(2);
		expect(state.messages.length).toBe(1);
	});

	test('tokens for different seq create separate bubbles', () => {
		let state = initialFrameState();
		state = applyFrame(state, token(1, 'a'));
		state = applyFrame(state, token(2, 'b'));
		expect(state.messages.length).toBe(2);
		expect(state.messages[0]!.seq).toBe(1);
		expect(state.messages[1]!.seq).toBe(2);
	});

	test('msg without prior token creates message directly', () => {
		let state = initialFrameState();
		state = applyFrame(state, userMsg(1, 'hi'));
		expect(state.messages.length).toBe(1);
		expect(state.messages[0]!.text).toBe('hi');
		expect(state.messages[0]!.role).toBe('user');
	});

	test('interrupted flag is preserved', () => {
		let state = initialFrameState();
		state = applyFrame(state, msg(1, 'partial', { interrupted: true }));
		expect(state.messages[0]!.interrupted).toBe(true);
	});

	test('tool frames are tracked separately', () => {
		let state = initialFrameState();
		const toolFrame: Frame = {
			v: 1,
			t: 'tool',
			seq: 1,
			runId: 'r1',
			name: 'sepia.search',
			status: 'ok',
			summary: '340 ms'
		} as Frame;
		state = applyFrame(state, toolFrame);
		expect(state.tools.length).toBe(1);
		expect(state.tools[0]!.name).toBe('sepia.search');
	});

	test('state frame updates busy', () => {
		let state = initialFrameState();
		expect(state.busy).toBe(false);
		const stateFrame: Frame = { v: 1, t: 'state', seq: 1, todos: [], busy: true, model: 'deepseek-chat' } as Frame;
		state = applyFrame(state, stateFrame);
		expect(state.busy).toBe(true);
	});

	test('err frames are surfaced in errs (not dropped)', () => {
		let state = initialFrameState();
		expect(state.errs.length).toBe(0);
		const errFrame = { v: 1, t: 'err', code: 'model', message: 'provider hiccup' } as Frame;
		state = applyFrame(state, errFrame);
		expect(state.errs.length).toBe(1);
		expect(state.errs[0]!.code).toBe('model');
		expect(state.errs[0]!.message).toBe('provider hiccup');
		// errs capped at 10
		for (let i = 0; i < 15; i++) {
			state = applyFrame(state, { v: 1, t: 'err', code: 'quota', message: `err ${i}` } as Frame);
		}
		expect(state.errs.length).toBe(10);
	});

	test('quota err is surfaced', () => {
		let state = initialFrameState();
		state = applyFrame(state, { v: 1, t: 'err', code: 'quota', message: 'daily cap reached' } as Frame);
		expect(state.errs[0]!.code).toBe('quota');
	});

	test('busy err is surfaced', () => {
		let state = initialFrameState();
		state = applyFrame(state, { v: 1, t: 'err', code: 'busy', message: 'already busy' } as Frame);
		expect(state.errs[0]!.code).toBe('busy');
	});
});
