/**
 * Pure formatting helpers — tested, no DOM.
 */

export type Price = { promptPerM: number; completionPerM: number };

export type ModelInfo = {
	id: string;
	label: string;
	provider: 'deepseek' | 'openrouter';
	contextLength?: number;
	price?: Price;
	priceKnown: boolean;
};

export function relativeTime(iso: string, nowMs: number = Date.now()): string {
	try {
		const d = new Date(iso);
		const t = d.getTime();
		if (!Number.isFinite(t)) return iso;
		const diff = nowMs - t;
		if (diff < 0) return 'just now';
		const mins = Math.floor(diff / 60000);
		if (mins < 1) return 'just now';
		if (mins < 60) return `${mins}m ago`;
		const hrs = Math.floor(mins / 60);
		if (hrs < 24) return `${hrs}h ago`;
		const days = Math.floor(hrs / 24);
		if (days < 7) return `${days}d ago`;
		return d.toLocaleDateString();
	} catch {
		return iso;
	}
}

export function formatPrice(model: Pick<ModelInfo, 'price' | 'priceKnown'>): string {
	if (!model.priceKnown || !model.price) return '—';
	const { promptPerM, completionPerM } = model.price;
	if (!Number.isFinite(promptPerM) || !Number.isFinite(completionPerM)) return '—';
	// Keep 2 decimals, but trim trailing zeros for readability? Brief says never guess — show exact.
	// Use fixed 2 for consistency; small values like 0.1 -> 0.10
	return `$${promptPerM.toFixed(2)} / $${completionPerM.toFixed(2)} per 1M`;
}

export function formatContextLength(n?: number): string {
	if (n === undefined || n === null || !Number.isFinite(n) || n <= 0) return '—';
	if (n >= 1000) {
		const k = n / 1000;
		// 128000 -> 128k, 1048576 -> 1048k? Actually 1048576/1000=1048.6k -> show as 1050k? Use k with one decimal if not integer
		if (Number.isInteger(k)) return `${k}k`;
		// For 131072 -> 131.1k -> round to 131k
		if (k >= 100) return `${Math.round(k)}k`;
		return `${k.toFixed(1).replace(/\.0$/, '')}k`;
	}
	return String(n);
}

export function nextBefore(frames: Array<{ seq: number }>): number | undefined {
	if (frames.length === 0) return undefined;
	const min = Math.min(...frames.map((f) => f.seq));
	return min;
}

export function hasMoreFromPage(page: { frames: unknown[]; hasMore: boolean }): boolean {
	return page.hasMore;
}
