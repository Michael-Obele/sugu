import { describe, test, expect } from 'bun:test';
import { backoffDelay, Backoff } from '../sugu/src/lib/backoff';

describe('backoff', () => {
	test('sequence is 1, 2, 4, 8 seconds', () => {
		expect(backoffDelay(0)).toBe(1000);
		expect(backoffDelay(1)).toBe(2000);
		expect(backoffDelay(2)).toBe(4000);
		expect(backoffDelay(3)).toBe(8000);
	});

	test('caps at 8 seconds', () => {
		expect(backoffDelay(4)).toBe(8000);
		expect(backoffDelay(5)).toBe(8000);
		expect(backoffDelay(10)).toBe(8000);
		expect(backoffDelay(100)).toBe(8000);
	});

	test('Backoff class sequences correctly', () => {
		const b = new Backoff();
		expect(b.next()).toBe(1000);
		expect(b.next()).toBe(2000);
		expect(b.next()).toBe(4000);
		expect(b.next()).toBe(8000);
		expect(b.next()).toBe(8000);
	});

	test('Backoff resets after successful connect', () => {
		const b = new Backoff();
		b.next(); // 1000
		b.next(); // 2000
		b.next(); // 4000
		expect(b.count).toBe(3);
		b.reset();
		expect(b.count).toBe(0);
		expect(b.next()).toBe(1000);
	});

	test('negative attempt returns 1000', () => {
		expect(backoffDelay(-1)).toBe(1000);
	});
});
