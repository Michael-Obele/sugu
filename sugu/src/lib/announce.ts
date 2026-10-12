/**
 * Throttled announcer for aria-live. Pure, testable.
 * - throttled(next): returns the text to announce now (at most once per interval)
 * - flush(): immediately announce pending text (trailing flush)
 * The caller drives it via $derived; the timer ensures final content is announced.
 */
export function createAnnouncer(intervalMs = 1000) {
	let lastAnnounce = 0;
	let pending: string | null = null;
	let timer: ReturnType<typeof setTimeout> | null = null;
	let current = '';

	function flush(): string | null {
		if (pending !== null) {
			current = pending;
			pending = null;
			lastAnnounce = Date.now();
		}
		if (timer !== null) {
			clearTimeout(timer);
			timer = null;
		}
		return current;
	}

	function throttled(next: string): string {
		const now = Date.now();
		if (now - lastAnnounce >= intervalMs) {
			current = next;
			lastAnnounce = now;
			pending = null;
			if (timer !== null) {
				clearTimeout(timer);
				timer = null;
			}
			return current;
		}
		pending = next;
		if (timer === null) {
			const delay = intervalMs - (now - lastAnnounce);
			timer = setTimeout(() => {
				if (pending !== null) {
					current = pending;
					pending = null;
					lastAnnounce = Date.now();
				}
				timer = null;
			}, delay);
		}
		return current;
	}

	return { throttled, flush, get currentText() { return current; }, get pendingText() { return pending; } };
}

/**
 * Pure function for testing: simulate throttling over a sequence of deltas.
 * Returns the announced values at each step (with trailing flush at end).
 */
export function simulateAnnounce(deltas: string[], intervalMs = 1000): { announced: string[]; final: string } {
	let last = 0;
	let pending: string | null = null;
	let current = '';
	const announced: string[] = [];
	let now = 0;
	let accumulated = '';
	for (const d of deltas) {
		accumulated += d;
		const next = accumulated;
		if (now - last >= intervalMs) {
			current = next;
			last = now;
			pending = null;
			announced.push(current);
		} else {
			pending = next;
		}
		now += 50; // 50ms between deltas
	}
	if (pending !== null) {
		current = pending;
		announced.push(current);
	}
	return { announced, final: current };
}
