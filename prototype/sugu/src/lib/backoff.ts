/**
 * Reconnect backoff: 1 → 2 → 4 → 8 s and then stay at 8 s. Pure.
 */

export function backoffDelay(attempt: number): number {
	if (attempt < 0) return 1000;
	return Math.min(1000 * Math.pow(2, attempt), 8000);
}

export class Backoff {
	private attempt = 0;

	next(): number {
		const delay = backoffDelay(this.attempt);
		this.attempt += 1;
		return delay;
	}

	reset(): void {
		this.attempt = 0;
	}

	get count(): number {
		return this.attempt;
	}
}
