import { describe, test, expect } from 'bun:test';
import { simulateAnnounce } from '../sugu/src/lib/announce';

describe('announce throttling', () => {
	test('many small deltas: final content always announced (trailing flush)', () => {
		const deltas = Array.from({ length: 30 }, (_, i) => `w${i} `);
		const { announced, final } = simulateAnnounce(deltas, 1000);
		const expected = deltas.join('');
		expect(final).toBe(expected);
		expect(announced[announced.length - 1]).toBe(expected);
	});

	test('single delta is announced immediately', () => {
		const { announced, final } = simulateAnnounce(['hello'], 1000);
		expect(final).toBe('hello');
		expect(announced.length).toBe(1);
	});

	test('empty deltas', () => {
		const { announced, final } = simulateAnnounce([], 1000);
		expect(final).toBe('');
		expect(announced.length).toBe(0);
	});
});
