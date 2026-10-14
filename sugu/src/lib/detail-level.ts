/**
 * Global tool detail level — compact ⇄ full.
 *
 * Pure storage logic (no runes) so it can be unit tested under `bun test`;
 * the reactive store lives in `detail-level.svelte.ts` and wraps this.
 *
 *   compact — one line per tool call: status + duration, no body
 *   full    — expandable raw output (respecting the AR-4 truncation marker)
 */

export type DetailLevel = 'compact' | 'full';

export const DETAIL_LEVEL_KEY = 'sugu_detail_level';

/** Minimal surface of `localStorage`, so tests can pass a fake. */
export type StorageLike =
	| {
			getItem(key: string): string | null;
			setItem(key: string, value: string): void;
	  }
	| null
	| undefined;

export function isDetailLevel(value: unknown): value is DetailLevel {
	return value === 'compact' || value === 'full';
}

/** Unknown, missing or unreadable values fall back to `compact`. */
export function readDetailLevel(storage: StorageLike): DetailLevel {
	try {
		const raw = storage?.getItem(DETAIL_LEVEL_KEY);
		return isDetailLevel(raw) ? raw : 'compact';
	} catch {
		return 'compact';
	}
}

/** Persistence failures (private mode, quota) are never fatal. */
export function writeDetailLevel(storage: StorageLike, level: DetailLevel): void {
	try {
		storage?.setItem(DETAIL_LEVEL_KEY, level);
	} catch {
		// ignore
	}
}

export function toggleDetailLevel(level: DetailLevel): DetailLevel {
	return level === 'compact' ? 'full' : 'compact';
}

export function detailLevelLabel(level: DetailLevel): string {
	return level === 'compact' ? 'Compact' : 'Full';
}

/** One-line description of what the current level does, for the palette row. */
export function detailLevelHint(level: DetailLevel): string {
	return level === 'compact' ? 'Tools: compact — one line each' : 'Tools: full — expandable output';
}

export function browserStorage(): StorageLike {
	return typeof localStorage === 'undefined' ? null : localStorage;
}
