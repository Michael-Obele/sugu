/**
 * Pure frame reducer: apply a decoded Frame to a message list.
 * Owns the "tokens keyed by seq, then replaced by the persisted msg" rule.
 */

import type { Frame } from '../../../src/shared/contracts';

export type DisplayMessage = {
	seq: number;
	id: number;
	role: 'user' | 'assistant' | 'system';
	text: string;
	interrupted?: boolean;
	streaming?: boolean;
};

export type ToolEntry = {
	seq: number;
	runId: string;
	name: string;
	status: 'running' | 'ok' | 'failed';
	summary?: string;
};

export type FrameState = {
	messages: DisplayMessage[];
	tools: ToolEntry[];
	busy: boolean;
	model: string;
	ignoredCount: number;
};

/**
 * Apply a single decoded Frame to the state. Returns a new state object.
 * Unknown/invalid frames are ignored (ignoredCount increments).
 * - token: appends delta to the streaming bubble for seq
 * - msg: replaces/places by seq (last persisted text wins)
 * - tool: upsert by runId
 * - state: updates busy/model
 * - err: ignored for display (surfaced elsewhere)
 */
export function applyFrame(state: FrameState, frame: Frame): FrameState {
	switch (frame.t) {
		case 'token': {
			const existing = state.messages.find((m) => m.seq === frame.seq);
			if (existing) {
				// Append to existing streaming bubble
				return {
					...state,
					messages: state.messages.map((m) =>
						m.seq === frame.seq ? { ...m, text: m.text + frame.delta, streaming: true } : m
					)
				};
			}
			// New streaming bubble for this seq
			const msg: DisplayMessage = {
				seq: frame.seq,
				id: frame.seq,
				role: 'assistant',
				text: frame.delta,
				streaming: true
			};
			return {
				...state,
				messages: insertBySeq(state.messages, msg)
			};
		}
		case 'msg': {
			const msg: DisplayMessage = {
				seq: frame.seq,
				id: frame.id,
				role: frame.role,
				text: frame.text,
				interrupted: frame.interrupted,
				streaming: false
			};
			const existing = state.messages.find((m) => m.seq === frame.seq);
			if (existing) {
				// Replace the streaming bubble with persisted text
				return {
					...state,
					messages: state.messages.map((m) => (m.seq === frame.seq ? msg : m))
				};
			}
			return {
				...state,
				messages: insertBySeq(state.messages, msg)
			};
		}
		case 'tool': {
			const entry: ToolEntry = {
				seq: frame.seq,
				runId: frame.runId,
				name: frame.name,
				status: frame.status,
				summary: frame.summary
			};
			const idx = state.tools.findIndex((t) => t.runId === frame.runId);
			if (idx !== -1) {
				const next = [...state.tools];
				next[idx] = entry;
				return { ...state, tools: next };
			}
			return { ...state, tools: [...state.tools, entry] };
		}
		case 'state': {
			return { ...state, busy: frame.busy, model: frame.model };
		}
		case 'err': {
			return state;
		}
		default: {
			// hello, send, cancel, approve, ack are not expected inbound
			return state;
		}
	}
}

/**
 * Apply a raw unknown frame: if it fails Valibot validation, ignore it.
 * Returns state unchanged and increments ignoredCount.
 */
export function applyRawFrame(state: FrameState, raw: unknown): FrameState {
	// We don't have parseFrame here without importing valibot; caller should
	// use parseFrame first. This is a convenience for testing unknown frames.
	// If raw is not a valid Frame shape, treat as ignored.
	if (!raw || typeof raw !== 'object') {
		return { ...state, ignoredCount: state.ignoredCount + 1 };
	}
	const r = raw as Record<string, unknown>;
	if (r['v'] !== 1 || typeof r['t'] !== 'string') {
		return { ...state, ignoredCount: state.ignoredCount + 1 };
	}
	// Valid envelope but unknown t - ignore
	const known = [
		'hello',
		'send',
		'cancel',
		'approve',
		'ack',
		'token',
		'msg',
		'tool',
		'state',
		'err'
	];
	if (!known.includes(r['t'] as string)) {
		return { ...state, ignoredCount: state.ignoredCount + 1 };
	}
	// Known t but we can't validate without Valibot - treat as ignored for this helper
	return { ...state, ignoredCount: state.ignoredCount + 1 };
}

export function initialFrameState(): FrameState {
	return {
		messages: [],
		tools: [],
		busy: false,
		model: 'deepseek-chat',
		ignoredCount: 0
	};
}

function insertBySeq(messages: DisplayMessage[], msg: DisplayMessage): DisplayMessage[] {
	const next = [...messages, msg];
	next.sort((a, b) => a.seq - b.seq);
	return next;
}
