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
	durationMs?: number;
	truncated?: boolean;
};

export type ErrEntry = {
	code: string;
	message: string;
	at: number;
};

export type FrameState = {
	messages: DisplayMessage[];
	tools: ToolEntry[];
	errs: ErrEntry[];
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
 * - err: appended to errs (surfaced in chat)
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
				summary: frame.summary,
				durationMs: (frame as unknown as { durationMs?: number }).durationMs,
				truncated: (frame as unknown as { truncated?: boolean }).truncated
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
			const entry: ErrEntry = { code: frame.code, message: frame.message, at: Date.now() };
			const next = [...state.errs, entry].slice(-10);
			return { ...state, errs: next };
		}
		default: {
			// Unknown inbound frame — ignore and count
			return { ...state, ignoredCount: state.ignoredCount + 1 };
		}
	}
}

export function initialFrameState(): FrameState {
	return {
		messages: [],
		tools: [],
		errs: [],
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
