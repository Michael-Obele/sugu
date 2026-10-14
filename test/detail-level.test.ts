import { describe, test, expect } from 'bun:test';
import {
	DETAIL_LEVEL_KEY,
	detailLevelHint,
	detailLevelLabel,
	isDetailLevel,
	readDetailLevel,
	toggleDetailLevel,
	writeDetailLevel
} from '../sugu/src/lib/detail-level';
import { activeTrigger, isLeadingTrigger, stripTriggerValue } from '../sugu/src/lib/composer-triggers';

function fakeStorage(initial: Record<string, string> = {}) {
	const map = new Map(Object.entries(initial));
	return {
		map,
		getItem: (key: string) => map.get(key) ?? null,
		setItem: (key: string, value: string) => void map.set(key, value)
	};
}

describe('detail level persistence', () => {
	test('defaults to compact when nothing is stored', () => {
		expect(readDetailLevel(fakeStorage())).toBe('compact');
	});

	test('defaults to compact without any storage (SSR / no localStorage)', () => {
		expect(readDetailLevel(null)).toBe('compact');
		expect(readDetailLevel(undefined)).toBe('compact');
	});

	test('reads a stored level back', () => {
		expect(readDetailLevel(fakeStorage({ [DETAIL_LEVEL_KEY]: 'full' }))).toBe('full');
		expect(readDetailLevel(fakeStorage({ [DETAIL_LEVEL_KEY]: 'compact' }))).toBe('compact');
	});

	test('ignores a corrupt stored value', () => {
		expect(readDetailLevel(fakeStorage({ [DETAIL_LEVEL_KEY]: 'loud' }))).toBe('compact');
		expect(readDetailLevel(fakeStorage({ [DETAIL_LEVEL_KEY]: '' }))).toBe('compact');
	});

	test('writes under the documented key so it survives a reload', () => {
		const storage = fakeStorage();
		writeDetailLevel(storage, 'full');
		expect(storage.map.get(DETAIL_LEVEL_KEY)).toBe('full');
		expect(readDetailLevel(storage)).toBe('full');
		writeDetailLevel(storage, 'compact');
		expect(readDetailLevel(storage)).toBe('compact');
	});

	test('a throwing storage never breaks the toggle', () => {
		const hostile = {
			getItem: () => {
				throw new Error('SecurityError');
			},
			setItem: () => {
				throw new Error('QuotaExceededError');
			}
		};
		expect(readDetailLevel(hostile)).toBe('compact');
		expect(() => writeDetailLevel(hostile, 'full')).not.toThrow();
	});

	test('toggle round-trips', () => {
		expect(toggleDetailLevel('compact')).toBe('full');
		expect(toggleDetailLevel('full')).toBe('compact');
		expect(toggleDetailLevel(toggleDetailLevel('compact'))).toBe('compact');
	});

	test('isDetailLevel narrows only the two levels', () => {
		expect(isDetailLevel('compact')).toBe(true);
		expect(isDetailLevel('full')).toBe(true);
		expect(isDetailLevel('COMPACT')).toBe(false);
		expect(isDetailLevel(null)).toBe(false);
		expect(isDetailLevel(undefined)).toBe(false);
	});

	test('labels and hints describe the current level', () => {
		expect(detailLevelLabel('compact')).toBe('Compact');
		expect(detailLevelLabel('full')).toBe('Full');
		expect(detailLevelHint('compact')).toContain('compact');
		expect(detailLevelHint('full')).toContain('full');
	});
});

describe('composer triggers', () => {
	test('a leading slash opens with an empty query', () => {
		expect(activeTrigger('/', 1, '/')).toEqual({ open: true, query: '', index: 0 });
	});

	test('a leading slash with text filters', () => {
		expect(activeTrigger('/det', 4, '/')).toEqual({ open: true, query: 'det', index: 0 });
	});

	test('case: the # picker behaves the same way', () => {
		expect(activeTrigger('#sk', 3, '#')).toEqual({ open: true, query: 'sk', index: 0 });
		expect(activeTrigger('use #sk', 7, '#')).toEqual({ open: true, query: 'sk', index: 4 });
	});

	test('a trigger after a space is still live', () => {
		const state = activeTrigger('hello /de', 9, '/');
		expect(state.open).toBe(true);
		expect(state.index).toBe(6);
		expect(state.query).toBe('de');
	});

	test('a trigger glued to a word is not live', () => {
		expect(activeTrigger('http://x', 8, '/').open).toBe(false);
		expect(activeTrigger('a#b', 3, '#').open).toBe(false);
	});

	test('a space ends the token', () => {
		expect(activeTrigger('/todo milk', 10, '/').open).toBe(false);
		expect(activeTrigger('/details ', 9, '/').open).toBe(false);
	});

	test('nothing typed means nothing open', () => {
		expect(activeTrigger('', 0, '/').open).toBe(false);
		expect(activeTrigger('plain text', 10, '/').open).toBe(false);
	});

	test('caret before the trigger does not count', () => {
		expect(activeTrigger('/details', 0, '/').open).toBe(false);
	});

	test('caret is clamped to the value length', () => {
		expect(activeTrigger('/det', 99, '/')).toEqual({ open: true, query: 'det', index: 0 });
	});

	test('isLeadingTrigger only accepts the first character', () => {
		expect(isLeadingTrigger('/de', 3, '/')).toBe(true);
		expect(isLeadingTrigger('say /de', 7, '/')).toBe(false);
		expect(isLeadingTrigger('plain', 5, '/')).toBe(false);
	});

	test('stripTriggerValue keeps whatever sits after the caret', () => {
		expect(stripTriggerValue('/det', 4)).toBe('');
		expect(stripTriggerValue('/det tail', 4)).toBe(' tail');
		expect(stripTriggerValue('/det', 2)).toBe('et');
	});
});
