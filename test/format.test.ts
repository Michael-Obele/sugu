import { describe, test, expect } from 'bun:test';
import { relativeTime, formatPrice, formatContextLength, nextBefore, hasMoreFromPage } from '../sugu/src/lib/format';

describe('relativeTime', () => {
	const now = new Date('2026-10-13T12:00:00.000Z').getTime();

	test('just now (<1m)', () => {
		expect(relativeTime(new Date(now - 10_000).toISOString(), now)).toBe('just now');
		expect(relativeTime(new Date(now - 30_000).toISOString(), now)).toBe('just now');
		expect(relativeTime(new Date(now).toISOString(), now)).toBe('just now');
	});

	test('minutes', () => {
		expect(relativeTime(new Date(now - 2 * 60_000).toISOString(), now)).toBe('2m ago');
		expect(relativeTime(new Date(now - 59 * 60_000).toISOString(), now)).toBe('59m ago');
	});

	test('hours', () => {
		expect(relativeTime(new Date(now - 60 * 60_000).toISOString(), now)).toBe('1h ago');
		expect(relativeTime(new Date(now - 5 * 60 * 60_000).toISOString(), now)).toBe('5h ago');
		expect(relativeTime(new Date(now - 23 * 60 * 60_000).toISOString(), now)).toBe('23h ago');
	});

	test('days', () => {
		expect(relativeTime(new Date(now - 24 * 60 * 60_000).toISOString(), now)).toBe('1d ago');
		expect(relativeTime(new Date(now - 6 * 24 * 60 * 60_000).toISOString(), now)).toBe('6d ago');
	});

	test('7+ days falls back to locale date', () => {
		const iso = new Date(now - 10 * 24 * 60 * 60_000).toISOString();
		const result = relativeTime(iso, now);
		// Should not be "just now" / "Xm ago" etc — should be a date string
		expect(result).not.toBe('just now');
		expect(result).not.toMatch(/^\d+[mhd] ago$/);
	});

	test('future date is just now', () => {
		expect(relativeTime(new Date(now + 60_000).toISOString(), now)).toBe('just now');
	});

	test('invalid iso returns input', () => {
		expect(relativeTime('not-a-date', now)).toBe('not-a-date');
	});
});

describe('formatPrice', () => {
	test('known price formats correctly', () => {
		expect(formatPrice({ priceKnown: true, price: { promptPerM: 0.27, completionPerM: 1.1 } })).toBe('$0.27 / $1.10 per 1M');
		expect(formatPrice({ priceKnown: true, price: { promptPerM: 2.5, completionPerM: 10 } })).toBe('$2.50 / $10.00 per 1M');
		expect(formatPrice({ priceKnown: true, price: { promptPerM: 0.1, completionPerM: 0.4 } })).toBe('$0.10 / $0.40 per 1M');
	});

	test('priceKnown false renders —', () => {
		expect(formatPrice({ priceKnown: false })).toBe('—');
		expect(formatPrice({ priceKnown: false, price: { promptPerM: 1, completionPerM: 2 } })).toBe('—');
	});

	test('priceKnown true but no price renders —', () => {
		expect(formatPrice({ priceKnown: true })).toBe('—');
	});

	test('priceKnown true but NaN renders —', () => {
		expect(formatPrice({ priceKnown: true, price: { promptPerM: NaN, completionPerM: 1 } })).toBe('—');
		expect(formatPrice({ priceKnown: true, price: { promptPerM: 1, completionPerM: Infinity } })).toBe('—');
	});

	test('zero price is valid and formats', () => {
		expect(formatPrice({ priceKnown: true, price: { promptPerM: 0, completionPerM: 0 } })).toBe('$0.00 / $0.00 per 1M');
	});
});

describe('formatContextLength', () => {
	test('undefined/null/NaN/0 renders —', () => {
		expect(formatContextLength(undefined)).toBe('—');
		expect(formatContextLength(NaN)).toBe('—');
		expect(formatContextLength(0)).toBe('—');
		expect(formatContextLength(-5)).toBe('—');
	});

	test('small numbers as-is', () => {
		expect(formatContextLength(512)).toBe('512');
		expect(formatContextLength(999)).toBe('999');
	});

	test('thousands as k', () => {
		expect(formatContextLength(1000)).toBe('1k');
		expect(formatContextLength(128000)).toBe('128k');
		expect(formatContextLength(200000)).toBe('200k');
	});

	test('non-round thousands', () => {
		// 131072 -> 131k (rounded)
		expect(formatContextLength(131072)).toBe('131k');
		// 1048576 -> 1049k? Actually 1048576/1000=1048.576 -> Math.round=1049k
		expect(formatContextLength(1048576)).toBe('1049k');
	});
});

describe('pagination helpers', () => {
	test('nextBefore returns min seq', () => {
		expect(nextBefore([{ seq: 5 }, { seq: 2 }, { seq: 8 }])).toBe(2);
		expect(nextBefore([{ seq: 10 }])).toBe(10);
	});

	test('nextBefore empty returns undefined', () => {
		expect(nextBefore([])).toBeUndefined();
	});

	test('hasMoreFromPage', () => {
		expect(hasMoreFromPage({ frames: [], hasMore: true })).toBe(true);
		expect(hasMoreFromPage({ frames: [], hasMore: false })).toBe(false);
		expect(hasMoreFromPage({ frames: [1, 2], hasMore: false })).toBe(false);
	});
});
