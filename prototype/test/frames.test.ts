import { describe, test, expect } from 'bun:test';
import { applyFrame, applyRawFrame, initialFrameState, type FrameState } from '../sugu/src/lib/frames';
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

	test('unknown/invalid frame is ignored rather than thrown', () => {
		let state = initialFrameState();
		state = applyFrame(state, msg(1, 'hello'));
		expect(state.messages.length).toBe(1);

		// Unknown frame via applyRawFrame
		const before = state.messages.length;
		state = applyRawFrame(state, { v: 1, t: 'unknown_frame', seq: 99 });
		expect(state.messages.length).toBe(before);
		expect(state.ignoredCount).toBe(1);

		// Invalid JSON-like object
		state = applyRawFrame(state, null);
		expect(state.ignoredCount).toBe(2);

		state = applyRawFrame(state, { v: 2, t: 'msg', seq: 1 });
		expect(state.ignoredCount).toBe(3);

		// Original messages still intact
		expect(state.messages.length).toBe(1);
		expect(state.messages[0]!.text).toBe('hello');
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
});
