/**
 * Whether reasoning parts are shown.
 * Pure storage logic (no runes) so it can be unit tested under bun test;
 * the reactive store lives in thinking.svelte.ts and wraps this.
 */

export type ThinkingMode = 'show' | 'hide';

export const THINKING_KEY = 'sugu_thinking';

export type StorageLike =
	| {
			getItem(key: string): string | null;
			setItem(key: string, value: string): void;
	  }
	| null
	| undefined;

export function isThinkingMode(value: unknown): value is ThinkingMode {
	return value === 'show' || value === 'hide';
}

export function readThinkingMode(storage: StorageLike): ThinkingMode {
	try {
		const raw = storage?.getItem(THINKING_KEY);
		return isThinkingMode(raw) ? raw : 'show';
	} catch {
		return 'show';
	}
}

export function writeThinkingMode(storage: StorageLike, mode: ThinkingMode): void {
	try {
		storage?.setItem(THINKING_KEY, mode);
	} catch {
		// ignore
	}
}

export function toggleThinkingMode(mode: ThinkingMode): ThinkingMode {
	return mode === 'show' ? 'hide' : 'show';
}

export function thinkingModeLabel(mode: ThinkingMode): string {
	return mode === 'show' ? 'Show thinking' : 'Hide thinking';
}

export function thinkingModeHint(mode: ThinkingMode): string {
	return mode === 'show' ? 'Thinking: shown' : 'Thinking: hidden';
}

export function browserStorage(): StorageLike {
	return typeof localStorage === 'undefined' ? null : localStorage;
}
