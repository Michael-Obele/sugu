# Batch 2C Report — live model catalogue

## Design

**Source:** `GET https://openrouter.ai/api/v1/models` (verified HTTP 200, no auth, ~770KB, 459 models). Shape `{ data: [{ id, name, context_length, pricing: { prompt, completion } }] }` where `pricing.prompt/completion` are per-token dollar strings (e.g. `"0.000004"` = $4/M).

**Modules:**
- `src/server/models.ts` — catalogue fetcher, parser, cache, filter, cost. `src/worker.ts` — `GET /api/models` now `await getModels(env)` returning `{ models, source, fetchedAt }`.
- `src/env.d.ts` — adds `SUGU_MODELS_URL`, `SUGU_MODELS_FILTER`.

**ModelInfo (settled for Batch 2B UI):**
```ts
type ModelInfo = {
  id: string; label: string; provider: 'deepseek'|'openrouter';
  contextLength?: number;
  price?: { promptPerM: number; completionPerM: number };
  priceKnown: boolean;
}
```
`priceKnown: false` → UI shows `—`, never a wrong number. Direct DeepSeek pricing is not publicly queryable via OpenRouter, so those entries may legitimately have no price; fallback provides known values but live always wins.

**Conversion:** `perTokenToPerM(s: string) => n * 1_000_000` in one place, unit-tested (including `"0.0000002"` → 0.2).

**Config overrides:**
- `SUGU_MODELS` (JSON array) wins immediately — no fetch, no cache. Validates entries; supports both new shape (`price: {promptPerM, completionPerM}`) and old shape (no price).
- `SUGU_MODELS_URL` overrides the fetch URL (default OpenRouter).
- `SUGU_MODELS_FILTER` — comma-separated case-insensitive substrings matched against `id` + `label`. Any narrowing is config, not a hardcoded allowlist. Applied after fetch/cache/override.

**Caching:** `caches.default` (Cache API, free, no new binding — same pattern as login throttle). TTL 4 hours. No refetch per request (770KB + 10ms CPU budget AR-4/AR-5). Flow: fresh cache hit → `source: 'cache'` without fetching; stale/miss → fetch live → `source: 'live'` and write cache; fetch failure with stale cache → `source: 'cache'` (last good); fetch failure with no cache → `source: 'fallback'` (small bundled `FALLBACK_MODELS`, 7 entries).

**Cost:** Deleted `PRICE_TABLE`. `costFor` now reads from an in-memory `priceMap` populated from the catalogue (live/cache/fallback). Unknown model → 0. Also handles `deepseek-chat` ↔ `deepseek/deepseek-chat` alias so live price for the OpenRouter variant covers the direct id.

**Test seam:** `MODEL_STUB=1` still gates `resolveAdapter`. Catalogue fetch is injectable (`fetchImpl`, `cacheImpl`) so tests use a trimmed fixture (`test/fixtures/openrouter-sample.json`, 7 models) not the network. When `MODEL_STUB=1`, `getModels` returns fallback without fetching.

## TTL chosen

4 hours. Rationale: prices change rarely (hours/days), the payload is 770KB, and the free tier CPU budget is 10ms/request — refetching per request would blow the budget. 4h balances freshness vs cost; operator can force a refresh by changing `SUGU_MODELS_URL` or purging cache.

## Filter mechanism

`SUGU_MODELS_FILTER="gpt-4o, Muse"` → split on `,`, trim, lowercase, match if `id` or `label` contains any term. Example: `gpt-4o` matches both `openai/gpt-4o` and `openai/gpt-4o-mini`. Comma-separated so 459 entries can be narrowed to a short picker without code change.

## Verification

```bash
bun tsc --noEmit
# exit 0

bun test
# 140 pass, 0 fail, 397 expect() calls, 11 files

bun test (second consecutive run)
# 140 pass, 0 fail, 397 expect() calls

mv .env /tmp/e && bun test && mv /tmp/e .env
# 140 pass, 0 fail (suite self-contained via TEST_SECRETS)
```

Suite was 120, now 140 (+20 in `test/batch2c.test.ts`). All green.

## Tests added

`test/batch2c.test.ts` — 20 tests:
- `perTokenToPerM`: 0.000004→4, 0.0000002→0.2, 0.0000025→2.5, zero, invalid
- `parseOpenRouterPayload`: fixture → 7 ModelInfo with per-M prices, tiny 0.2, zero→priceKnown false, deepseek 0.27, empty/invalid→[]
- Cache: hit does not refetch, expiry refetches, failed refetch serves last good, no cache+fail→fallback
- `SUGU_MODELS` wins, `SUGU_MODELS_FILTER` narrows, comma-separated
- `costFor`: unknown→0, known uses live price, tiny per-M

Fixture: `test/fixtures/openrouter-sample.json` — 7 entries trimmed from live shape (not 770KB).

## What could not be verified

- Live fetch against `https://openrouter.ai/api/v1/models` was not exercised in CI (tests use fixture). Manual `curl` would confirm shape but was not run in this session.
- `caches.default` behaviour in `wrangler dev` vs production — the Cache API is available in both, but TTL eviction timing in production was not measured.
- OpenCode Go catalogue (`https://zp.svelte-apps.me/llms.txt`) was not checked — per brief, mention if found but do not wire in. Not investigated in this batch.

## Concerns

- `priceMap` is in-memory per isolate — each Worker isolate populates it on first `getModels` call. `costFor` called before any `getModels` still works via `FALLBACK_MODELS` fallback, but the first request after a cold start will use fallback prices until the catalogue is fetched. This is acceptable (fallback prices are the same as the old hardcoded table).
- `SUGU_MODELS` override returns `source: 'fallback'` — semantically it is an operator-supplied static list, not a fetch failure. Could be `source: 'static'` but brief specifies `live|cache|fallback`, so `fallback` is used.
- `filterModels` after caching: we cache the unfiltered live result and filter on read, so a later request with a different filter still hits cache. If the filter is changed, the next request will be a cache hit (filtered view) without refetch — correct.
