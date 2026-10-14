/**
 * Reactive holder for the global detail level.
 * All persistence lives in the pure `detail-level.ts` module.
 */
import {
	browserStorage,
	readDetailLevel,
	writeDetailLevel,
	toggleDetailLevel,
	type DetailLevel
} from './detail-level';

export class DetailLevelStore {
	level = $state<DetailLevel>(readDetailLevel(browserStorage()));

	set(level: DetailLevel): void {
		this.level = level;
		writeDetailLevel(browserStorage(), level);
	}

	toggle(): DetailLevel {
		const next = toggleDetailLevel(this.level);
		this.set(next);
		return next;
	}
}

export const detailLevelStore = new DetailLevelStore();
