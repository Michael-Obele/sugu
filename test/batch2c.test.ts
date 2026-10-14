import { describe, test, expect, beforeEach } from 'bun:test';
import {
	perTokenToPerM,
	parseOpenRouterPayload,
	costFor,
	__setPriceMapForTests,
	__resetPriceMapForTests,
	getModels,
	CACHE_TTL_MS
} from '../src/server/models';
import fixture from './fixtures/openrouter-sample.json';

// ---------------------------------------------------------------------------
// Helpers: in-memory Cache stub
// ---------------------------------------------------------------------------
function makeCache(): { cache: Cache; putCalls: number } {
	const store = new Map<string, Response>();
	let putCalls = 0;
	const cache = {
		async match(req: Request): Promise<Response | undefined> {
			const v = store.get(req.url);
			if (!v) return undefined;
			return v.clone();
		},
		async put(req: Request, res: Response): Promise<void> {
			putCalls++;
			store.set(req.url, res.clone());
		},
		async delete(req: Request): Promise<boolean> {
			return store.delete(req.url);
		}
	} as unknown as Cache;
	return {
		cache,
		get putCalls() {
			return putCalls;
		}
	};
}

function makeFetchSuccess(data: unknown): typeof fetch {
	return (async (_url: string | URL | Request, _init?: RequestInit) => {
		return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
	}) as unknown as typeof fetch;
}

function makeFetchFail(status = 500): typeof fetch {
	return (async () => new Response('fail', { status })) as unknown as typeof fetch;
}

function makeFetchCounter(data: unknown): { fetch: typeof fetch; calls: () => number } {
	let calls = 0;
	const fn = (async () => {
		calls++;
		return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
	}) as unknown as typeof fetch;
	return { fetch: fn, calls: () => calls };
}

// ---------------------------------------------------------------------------
// perTokenToPerM
// ---------------------------------------------------------------------------
describe('batch2c: perTokenToPerM', () => {
	test('converts 0.000004 to 4', () => {
		expect(perTokenToPerM('0.000004')).toBe(4);
	});
	test('converts 0.0000002 to 0.2', () => {
		expect(perTokenToPerM('0.0000002')).toBeCloseTo(0.2, 10);
	});
	test('converts 0.0000025 to 2.5', () => {
		expect(perTokenToPerM('0.0000025')).toBe(2.5);
	});
	test('zero returns 0', () => {
		expect(perTokenToPerM('0')).toBe(0);
	});
	test('invalid returns 0', () => {
		expect(perTokenToPerM('not-a-number')).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// parseOpenRouterPayload
// ---------------------------------------------------------------------------
describe('batch2c: parseOpenRouterPayload', () => {
	test('parses fixture into ModelInfo[] with per-million prices', () => {
		const models = parseOpenRouterPayload(fixture);
		expect(models.length).toBe(7);
		const wonder = models.find((m) => m.id === 'meta/muse-wonder')!;
		expect(wonder).toBeDefined();
		expect(wonder.label).toBe('Muse Wonder');
		expect(wonder.contextLength).toBe(1048576);
		expect(wonder.priceKnown).toBe(true);
		expect(wonder.price!.promptPerM).toBe(4);
		expect(wonder.price!.completionPerM).toBe(20);
	});

	test('tiny model 0.0000002 -> 0.2 per M', () => {
		const models = parseOpenRouterPayload(fixture);
		const tiny = models.find((m) => m.id === 'tiny/model')!;
		expect(tiny.priceKnown).toBe(true);
		expect(tiny.price!.promptPerM).toBeCloseTo(0.2, 10);
		expect(tiny.price!.completionPerM).toBeCloseTo(0.4, 10);
	});

	test('zero price -> priceKnown false', () => {
		const models = parseOpenRouterPayload(fixture);
		const noprice = models.find((m) => m.id === 'no-price/model')!;
		expect(noprice.priceKnown).toBe(false);
		expect(noprice.price).toBeUndefined();
	});

	test('deepseek-chat 0.00000027 -> 0.27', () => {
		const models = parseOpenRouterPayload(fixture);
		const ds = models.find((m) => m.id === 'deepseek/deepseek-chat')!;
		expect(ds.price!.promptPerM).toBeCloseTo(0.27, 10);
		expect(ds.price!.completionPerM).toBeCloseTo(1.1, 10);
	});

	test('empty/invalid payload returns []', () => {
		expect(parseOpenRouterPayload(null)).toEqual([]);
		expect(parseOpenRouterPayload({})).toEqual([]);
		expect(parseOpenRouterPayload({ data: 'not-array' })).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Cache behaviour
// ---------------------------------------------------------------------------
describe('batch2c: catalogue caching', () => {
	test('cache hit does not refetch', async () => {
		const { cache } = makeCache();
		const { fetch: countingFetch, calls } = makeFetchCounter(fixture);
		const first = await getModels({}, { fetchImpl: countingFetch, cacheImpl: cache });
		expect(first.source).toBe('live');
		expect(calls()).toBe(1);
		const second = await getModels({}, { fetchImpl: countingFetch, cacheImpl: cache });
		expect(second.source).toBe('cache');
		expect(calls()).toBe(1);
	});

	test('expiry refetches', async () => {
		const { cache } = makeCache();
		const { fetch: countingFetch, calls } = makeFetchCounter(fixture);
		// Seed cache with stale entry
		const stale: unknown = {
			models: parseOpenRouterPayload(fixture),
			source: 'live' as const,
			fetchedAt: new Date(Date.now() - CACHE_TTL_MS - 1000).toISOString()
		};
		await cache.put(new Request('https://sugu-cache/models'), new Response(JSON.stringify(stale)));
		const result = await getModels({}, { fetchImpl: countingFetch, cacheImpl: cache });
		expect(result.source).toBe('live');
		expect(calls()).toBe(1);
	});

	test('failed refetch still serves last good copy', async () => {
		const { cache } = makeCache();
		// Seed with fresh cache
		const fresh = await getModels({}, { fetchImpl: makeFetchSuccess(fixture), cacheImpl: cache });
		expect(fresh.source).toBe('live');
		// Now make cache stale and fetch fail
		const stale: unknown = {
			models: parseOpenRouterPayload(fixture),
			source: 'live' as const,
			fetchedAt: new Date(Date.now() - CACHE_TTL_MS - 1000).toISOString()
		};
		await cache.put(new Request('https://sugu-cache/models'), new Response(JSON.stringify(stale)));
		const result = await getModels({}, { fetchImpl: makeFetchFail(), cacheImpl: cache });
		expect(result.source).toBe('cache');
		expect(result.models.length).toBeGreaterThan(0);
	});

	test('no cache + failed fetch -> fallback', async () => {
		const { cache } = makeCache();
		const result = await getModels({}, { fetchImpl: makeFetchFail(), cacheImpl: cache });
		expect(result.source).toBe('fallback');
		expect(result.models.length).toBeGreaterThan(0);
	});
});

// ---------------------------------------------------------------------------
// SUGU_MODELS override and filter
// ---------------------------------------------------------------------------
describe('batch2c: SUGU_MODELS and SUGU_MODELS_FILTER', () => {
	test('SUGU_MODELS static override wins', async () => {
		const custom = JSON.stringify([
			{ id: 'custom/model', label: 'Custom', provider: 'openrouter', price: { promptPerM: 1, completionPerM: 2 }, priceKnown: true }
		]);
		// Even with a failing fetch, override should win without hitting network
		// but direct models + defaultModel invariant still holds (B2)
		const result = await getModels({ SUGU_MODELS: custom }, { fetchImpl: makeFetchFail(), cacheImpl: makeCache().cache });
		expect(result.models.some((m) => m.id === 'custom/model')).toBe(true);
		expect(result.models.some((m) => m.id === 'deepseek-chat')).toBe(true);
		expect(result.models.some((m) => m.id === 'deepseek-reasoner')).toBe(true);
		expect(result.models.some((m) => m.id === result.defaultModel)).toBe(true);
	});

	test('SUGU_MODELS_FILTER narrows', async () => {
		const { cache } = makeCache();
		const result = await getModels({ SUGU_MODELS_FILTER: 'gpt-4o' }, { fetchImpl: makeFetchSuccess(fixture), cacheImpl: cache });
		// fixture has gpt-4o and gpt-4o-mini — both contain gpt-4o
		expect(result.models.length).toBe(2);
		expect(result.models.every((m) => m.id.includes('gpt-4o'))).toBe(true);
	});

	test('filter is comma-separated', async () => {
		const { cache } = makeCache();
		const result = await getModels({ SUGU_MODELS_FILTER: 'Muse Wonder, tiny' }, { fetchImpl: makeFetchSuccess(fixture), cacheImpl: cache });
		expect(result.models.length).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// costFor with live prices
// ---------------------------------------------------------------------------
describe('batch2c: costFor with live prices', () => {
	beforeEach(() => {
		__resetPriceMapForTests();
	});

	test('unknown model -> cost 0', () => {
		__setPriceMapForTests([]);
		expect(costFor('unknown-model-xyz', 1000, 1000)).toBe(0);
	});

	test('known model uses live price', () => {
		__setPriceMapForTests([['openai/gpt-4o', { promptPerM: 2.5, completionPerM: 10 }]]);
		const cost = costFor('openai/gpt-4o', 1_000_000, 1_000_000);
		expect(cost).toBe(12.5);
	});

	test('per-million conversion: tiny model', () => {
		__setPriceMapForTests([['tiny/model', { promptPerM: 0.2, completionPerM: 0.4 }]]);
		const cost = costFor('tiny/model', 1_000_000, 1_000_000);
		expect(cost).toBeCloseTo(0.6, 10);
	});
});
