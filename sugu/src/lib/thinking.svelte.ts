/**
 * Reactive holder for the thinking visibility.
 * All persistence lives in the pure thinking.ts module.
 */
import {
	browserStorage,
	readThinkingMode,
	writeThinkingMode,
	toggleThinkingMode,
	type ThinkingMode
} from './thinking';

export class ThinkingStore {
	mode = $state<ThinkingMode>(readThinkingMode(browserStorage()));

	set(mode: ThinkingMode): void {
		this.mode = mode;
		writeThinkingMode(browserStorage(), mode);
	}

	toggle(): ThinkingMode {
		const next = toggleThinkingMode(this.mode);
		this.set(next);
		return next;
	}
}

export const thinkingStore = new ThinkingStore();
