/**
 * Pure detection of a `/` or `#` trigger token in the composer.
 *
 * A trigger is live when the character before the caret's token is the trigger
 * char, that char starts the value or follows whitespace, and the token has no
 * whitespace yet (`/details` is live, `/todo milk` is not).
 */

export type TriggerState = {
	open: boolean;
	query: string;
	/** index of the trigger char in the value, -1 when closed */
	index: number;
};

const CLOSED: TriggerState = { open: false, query: '', index: -1 };

export function activeTrigger(value: string, caret: number, char: string): TriggerState {
	if (!char) return CLOSED;
	const pos = Math.max(0, Math.min(caret, value.length));
	const before = value.slice(0, pos);
	const idx = before.lastIndexOf(char);
	if (idx === -1) return CLOSED;
	if (idx > 0 && !/\s/.test(before[idx - 1]!)) return CLOSED;
	const query = before.slice(idx + 1);
	if (/\s/.test(query)) return CLOSED;
	return { open: true, query, index: idx };
}

/** True when the trigger is the very first character of the message. */
export function isLeadingTrigger(value: string, caret: number, char: string): boolean {
	const state = activeTrigger(value, caret, char);
	return state.open && state.index === 0;
}

/** Text to keep once the trigger token is handed over to a picker. */
export function stripTriggerValue(value: string, caret: number): string {
	const pos = Math.max(0, Math.min(caret, value.length));
	return value.slice(pos);
}

export function insertAtCaret(value: string, caret: number, insertion: string): string {
	const pos = Math.max(0, Math.min(caret, value.length));
	return value.slice(0, pos) + insertion + value.slice(pos);
}
