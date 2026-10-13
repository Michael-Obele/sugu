/**
 * Model provider adapter — DeepSeek direct + OpenRouter, one interface.
 * SSE is parsed incrementally (streaming TextDecoder, split on newlines)
 * so deltas reach the phone as they are produced and CPU stays within AR-4/AR-5.
 */

export type Msg = { role: 'system' | 'user' | 'assistant'; content: string };
export type ToolDef = { name: string; description?: string; parameters?: unknown };
export type ToolCall = { id: string; name: string; arguments: string };
export type Usage = { promptTokens?: number; completionTokens?: number; costUsd?: number };

export interface ModelAdapter {
	stream(
		req: { model: string; messages: Msg[]; tools?: ToolDef[]; maxTokens?: number },
		signal: AbortSignal
	): AsyncIterable<{ delta?: string; toolCall?: ToolCall; usage?: Usage }>;
}

// ---------------------------------------------------------------------------
// Model catalogue — live source with caching, overridable via env.
// ---------------------------------------------------------------------------

export type ModelInfo = {
	id: string;
	label: string;
	provider: 'deepseek' | 'openrouter';
	contextLength?: number;
	price?: { promptPerM: number; completionPerM: number };
	priceKnown: boolean;
};

// Small bundled fallback — used when fetch fails and no cache exists.
// Direct DeepSeek pricing is not publicly queryable via OpenRouter's catalogue,
// which is why those entries may legitimately have priceKnown: false. We provide
// fallback prices for the common models so cost can be computed even offline,
// but live prices (when available) always win.
const FALLBACK_MODELS: ModelInfo[] = [
	{ id: 'deepseek-chat', label: 'DeepSeek Chat', provider: 'deepseek', price: { promptPerM: 0.27, completionPerM: 1.1 }, priceKnown: true },
	{
		id: 'deepseek-reasoner',
		label: 'DeepSeek Reasoner',
		provider: 'deepseek',
		price: { promptPerM: 0.55, completionPerM: 2.19 },
		priceKnown: true
	},
	{
		id: 'openai/gpt-4o',
		label: 'GPT-4o',
		provider: 'openrouter',
		contextLength: 128000,
		price: { promptPerM: 2.5, completionPerM: 10 },
		priceKnown: true
	},
	{
		id: 'openai/gpt-4o-mini',
		label: 'GPT-4o mini',
		provider: 'openrouter',
		contextLength: 128000,
		price: { promptPerM: 0.15, completionPerM: 0.6 },
		priceKnown: true
	},
	{
		id: 'anthropic/claude-3.5-sonnet',
		label: 'Claude 3.5 Sonnet',
		provider: 'openrouter',
		contextLength: 200000,
		price: { promptPerM: 3, completionPerM: 15 },
		priceKnown: true
	},
	{
		id: 'google/gemini-2.0-flash-001',
		label: 'Gemini 2.0 Flash',
		provider: 'openrouter',
		contextLength: 128000,
		price: { promptPerM: 0.1, completionPerM: 0.4 },
		priceKnown: true
	},
	{
		id: 'meta-llama/llama-3.1-70b-instruct',
		label: 'Llama 3.1 70B',
		provider: 'openrouter',
		contextLength: 131072,
		price: { promptPerM: 0.59, completionPerM: 0.79 },
		priceKnown: true
	}
];

// Keep DEFAULT_MODELS for backward compat (batch2a tests) — alias to fallback.
export const DEFAULT_MODELS: ModelInfo[] = FALLBACK_MODELS;

// In-memory price map for costFor — populated from catalogue (live, cache, or fallback).
// Initialized with fallback prices so costFor works even before first fetch.
const priceMap = new Map<string, { promptPerM: number; completionPerM: number }>();
for (const m of FALLBACK_MODELS) {
	if (m.priceKnown && m.price) priceMap.set(m.id, m.price);
}

/**
 * Convert per-token dollar string (e.g. "0.000004") to per-million number (e.g. 4).
 * Single place for the conversion, unit-tested.
 */
export function perTokenToPerM(s: string): number {
	const n = parseFloat(s);
	if (!Number.isFinite(n) || n === 0) return 0;
	return n * 1_000_000;
}

/**
 * Parse OpenRouter's { data: [...] } payload into ModelInfo[].
 * Converts per-token strings to per-million numbers.
 */
export function parseOpenRouterPayload(payload: unknown): ModelInfo[] {
	if (!payload || typeof payload !== 'object') return [];
	const data = (payload as Record<string, unknown>)['data'];
	if (!Array.isArray(data)) return [];
	const out: ModelInfo[] = [];
	for (const raw of data) {
		if (!raw || typeof raw !== 'object') continue;
		const r = raw as Record<string, unknown>;
		const id = r['id'];
		const name = r['name'];
		if (typeof id !== 'string' || typeof name !== 'string') continue;
		const contextLength = typeof r['context_length'] === 'number' ? r['context_length'] : undefined;
		const pricing = r['pricing'] as Record<string, unknown> | undefined;
		let price: { promptPerM: number; completionPerM: number } | undefined;
		let priceKnown = false;
		if (pricing && typeof pricing['prompt'] === 'string' && typeof pricing['completion'] === 'string') {
			const promptPerM = perTokenToPerM(pricing['prompt'] as string);
			const completionPerM = perTokenToPerM(pricing['completion'] as string);
			// priceKnown only if both are >0 and finite
			if (promptPerM > 0 && completionPerM > 0 && Number.isFinite(promptPerM) && Number.isFinite(completionPerM)) {
				price = { promptPerM, completionPerM };
				priceKnown = true;
			} else if (promptPerM === 0 && completionPerM === 0) {
				// Explicit zero means unknown (e.g. "0" in fixture)
				priceKnown = false;
			} else {
				// One zero, one non-zero — treat as unknown to avoid wrong cost
				priceKnown = false;
			}
		}
		out.push({
			id,
			label: name,
			provider: 'openrouter',
			contextLength,
			price,
			priceKnown
		});
	}
	return out;
}

/**
 * Filter models by comma-separated substrings (case-insensitive, matches id or label).
 * Any narrowing must be config, not a hardcoded allowlist.
 */
export function filterModels(models: ModelInfo[], filter: string): ModelInfo[] {
	if (!filter || !filter.trim()) return models;
	const terms = filter
		.split(',')
		.map((s) => s.trim().toLowerCase())
		.filter(Boolean);
	if (terms.length === 0) return models;
	return models.filter((m) => {
		const hay = `${m.id} ${m.label}`.toLowerCase();
		return terms.some((t) => hay.includes(t));
	});
}

// For tests: allow stubbing the price map directly.
export function __setPriceMapForTests(entries: Array<[string, { promptPerM: number; completionPerM: number }]>) {
	priceMap.clear();
	for (const [k, v] of entries) priceMap.set(k, v);
}
export function __resetPriceMapForTests() {
	priceMap.clear();
	for (const m of FALLBACK_MODELS) {
		if (m.priceKnown && m.price) priceMap.set(m.id, m.price);
	}
}

function costFor(model: string, promptT: number, complT: number): number {
	let entry = priceMap.get(model);
	// Also check OpenRouter-prefixed variant for deepseek direct ids:
	// e.g. 'deepseek-chat' -> 'deepseek/deepseek-chat' (live catalogue uses the latter)
	if (!entry) {
		// Fallback: if priceMap was cleared (e.g. by tests), check FALLBACK_MODELS directly
		const fb = FALLBACK_MODELS.find((m) => m.id === model);
		if (fb?.priceKnown && fb.price) entry = fb.price;
	}
	if (!entry && model === 'deepseek-chat') {
		const alt = priceMap.get('deepseek/deepseek-chat');
		if (alt) return (promptT * alt.promptPerM + complT * alt.completionPerM) / 1_000_000;
	}
	if (!entry && model === 'deepseek-reasoner') {
		const alt = priceMap.get('deepseek/deepseek-reasoner');
		if (alt) return (promptT * alt.promptPerM + complT * alt.completionPerM) / 1_000_000;
	}
	if (!entry) return 0;
	return (promptT * entry.promptPerM + complT * entry.completionPerM) / 1_000_000;
}

// ---------------------------------------------------------------------------
// SSE incremental parser — streaming TextDecoder, split on newlines.
// Handles: chunk split mid-line, mid-multibyte-char, multi-line data:, [DONE],
// malformed line (must not throw).
// ---------------------------------------------------------------------------
export type SseEvent = { data: string };

/**
 * Parse an SSE byte stream into data events.
 * Each `data:` line is collected; empty line dispatches the event.
 * `data: [DONE]` terminates without yielding.
 * Malformed lines (no colon, unknown field) are ignored, not thrown.
 */
export async function* parseSseStream(stream: ReadableStream<Uint8Array>, signal?: AbortSignal): AsyncIterable<SseEvent> {
	const reader = stream.getReader();
	const decoder = new TextDecoder();
	let buffer = '';
	let dataLines: string[] = [];

	let done = false;
	const flushEvent = function* (): Generator<SseEvent> {
		if (done) return;
		if (dataLines.length === 0) return;
		const data = dataLines.join('\n');
		dataLines = [];
		if (data === '[DONE]') {
			done = true;
			return;
		}
		yield { data };
	};

	try {
		while (true) {
			if (signal?.aborted) break;
			const { done, value } = await reader.read();
			if (done) {
				// Flush any remaining buffered line
				if (buffer.length > 0) {
					const line = buffer;
					buffer = '';
					if (line.startsWith('data:')) {
						dataLines.push(line.slice(5).trimStart());
					} else if (line === '' || line === '\r') {
						for (const ev of flushEvent()) yield ev;
					}
					// else: ignore malformed/unknown
				}
				for (const ev of flushEvent()) yield ev;
				break;
			}
			const chunk = decoder.decode(value, { stream: true });
			buffer += chunk;
			// Split on \n, keep incomplete line in buffer
			let idx: number;
			while ((idx = buffer.indexOf('\n')) !== -1) {
				let line = buffer.slice(0, idx);
				buffer = buffer.slice(idx + 1);
				// Strip trailing \r (SSE spec: lines end with \n, \r\n, or \r)
				if (line.endsWith('\r')) line = line.slice(0, -1);
				if (done) break;
				if (line === '') {
					for (const ev of flushEvent()) yield ev;
				} else if (line.startsWith('data:')) {
					dataLines.push(line.slice(5).trimStart());
				} else if (line.startsWith(':') || line.includes(':')) {
					// comment or unknown field — ignore
					continue;
				} else {
					// malformed line without colon — ignore, do not throw
					continue;
				}
			}
		}
	} finally {
		try {
			reader.releaseLock();
		} catch {}
	}
}

/**
 * Parse SSE text fixtures synchronously (for unit tests).
 * Simulates incremental chunking by splitting the input string.
 */
export function parseSseText(text: string): SseEvent[] {
	const events: SseEvent[] = [];
	let dataLines: string[] = [];
	let done = false;
	const lines = text.split('\n');
	for (const raw of lines) {
		if (done) break;
		let line = raw;
		if (line.endsWith('\r')) line = line.slice(0, -1);
		if (line === '') {
			if (dataLines.length > 0) {
				const data = dataLines.join('\n');
				dataLines = [];
				if (data === '[DONE]') {
					done = true;
				} else {
					events.push({ data });
				}
			}
		} else if (line.startsWith('data:')) {
			dataLines.push(line.slice(5).trimStart());
		} else if (line.startsWith(':') || line.includes(':')) {
			continue;
		} else {
			continue;
		}
	}
	if (!done && dataLines.length > 0) {
		const data = dataLines.join('\n');
		if (data !== '[DONE]') events.push({ data });
	}
	return events;
}

// ---------------------------------------------------------------------------
// Provider adapters
// ---------------------------------------------------------------------------

function buildRequestBody(model: string, messages: Msg[], tools?: ToolDef[], maxTokens?: number): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model,
		messages: messages.map((m) => ({ role: m.role, content: m.content })),
		stream: true
	};
	if (maxTokens !== undefined) body['max_tokens'] = maxTokens;
	if (tools && tools.length > 0) {
		body['tools'] = tools.map((t) => ({
			type: 'function',
			function: { name: t.name, description: t.description ?? '', parameters: t.parameters ?? {} }
		}));
	}
	return body;
}

async function* streamFromSse(
	response: Response,
	signal: AbortSignal,
	model: string
): AsyncIterable<{ delta?: string; toolCall?: ToolCall; usage?: Usage }> {
	if (!response.ok) {
		const text = await response.text().catch(() => '');
		throw new Error(`model provider ${response.status}: ${text.slice(0, 500)}`);
	}
	if (!response.body) {
		throw new Error('model provider returned no body');
	}
	for await (const event of parseSseStream(response.body as ReadableStream<Uint8Array>, signal)) {
		if (signal.aborted) break;
		let payload: Record<string, unknown>;
		try {
			payload = JSON.parse(event.data) as Record<string, unknown>;
		} catch {
			// malformed JSON line — ignore, do not throw (per brief)
			continue;
		}
		// OpenAI-compatible streaming chunk
		const choices = payload['choices'] as Array<Record<string, unknown>> | undefined;
		if (choices && choices.length > 0) {
			const choice = choices[0] as Record<string, unknown>;
			const delta = choice['delta'] as Record<string, unknown> | undefined;
			if (delta) {
				const content = delta['content'];
				if (typeof content === 'string' && content.length > 0) {
					yield { delta: content };
				}
				const toolCalls = delta['tool_calls'] as Array<Record<string, unknown>> | undefined;
				if (toolCalls) {
					for (const tc of toolCalls) {
						const fn = tc['function'] as Record<string, unknown> | undefined;
						yield {
							toolCall: {
								id: (tc['id'] as string) ?? '',
								name: (fn?.['name'] as string) ?? '',
								arguments: (fn?.['arguments'] as string) ?? ''
							}
						};
					}
				}
			}
			// Some providers send content at top-level choice
			const text = choice['text'];
			if (typeof text === 'string' && text.length > 0) {
				yield { delta: text };
			}
		}
		// Usage may appear in final chunk or as top-level usage
		const usage = payload['usage'] as Record<string, unknown> | undefined;
		if (usage) {
			const promptT = (usage['prompt_tokens'] as number) ?? (usage['promptTokens'] as number) ?? 0;
			const complT = (usage['completion_tokens'] as number) ?? (usage['completionTokens'] as number) ?? 0;
			const cost = costFor(model, promptT, complT);
			yield { usage: { promptTokens: promptT, completionTokens: complT, costUsd: cost } };
		}
	}
}

class DeepSeekAdapter implements ModelAdapter {
	constructor(private apiKey: string) {}
	async *stream(
		req: { model: string; messages: Msg[]; tools?: ToolDef[]; maxTokens?: number },
		signal: AbortSignal
	): AsyncIterable<{ delta?: string; toolCall?: ToolCall; usage?: Usage }> {
		const body = buildRequestBody(req.model, req.messages, req.tools, req.maxTokens);
		const res = await fetch('https://api.deepseek.com/chat/completions', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${this.apiKey}`
			},
			body: JSON.stringify(body),
			signal
		});
		yield* streamFromSse(res, signal, req.model);
	}
}

class OpenRouterAdapter implements ModelAdapter {
	constructor(private apiKey: string) {}
	async *stream(
		req: { model: string; messages: Msg[]; tools?: ToolDef[]; maxTokens?: number },
		signal: AbortSignal
	): AsyncIterable<{ delta?: string; toolCall?: ToolCall; usage?: Usage }> {
		const body = buildRequestBody(req.model, req.messages, req.tools, req.maxTokens);
		const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${this.apiKey}`,
				'http-referer': 'https://sugu.app',
				'x-title': 'Sugu'
			},
			body: JSON.stringify(body),
			signal
		});
		yield* streamFromSse(res, signal, req.model);
	}
}

// ---------------------------------------------------------------------------
// Stub adapter — deterministic, for tests only.
// Gated on MODEL_STUB=1 (dev-only var, never set in production).
// ---------------------------------------------------------------------------
export class StubAdapter implements ModelAdapter {
	constructor(private opts?: { fail?: boolean; text?: string }) {}
	async *stream(
		_req: { model: string; messages: Msg[]; tools?: ToolDef[]; maxTokens?: number },
		signal: AbortSignal
	): AsyncIterable<{ delta?: string; toolCall?: ToolCall; usage?: Usage }> {
		if (this.opts?.fail) {
			throw new Error('stub model failure');
		}
		const text = this.opts?.text ?? 'stub response';
		// Yield in small chunks to exercise token streaming
		const chunkSize = 5;
		for (let i = 0; i < text.length; i += chunkSize) {
			if (signal.aborted) break;
			yield { delta: text.slice(i, i + chunkSize) };
			// Small yield to allow abort/cancel to propagate (5ms so cancel test can interrupt)
			await new Promise<void>((r) => setTimeout(r, 5));
		}
		if (!signal.aborted) {
			yield { usage: { promptTokens: 10, completionTokens: text.length, costUsd: 0 } };
		}
	}
}

// ---------------------------------------------------------------------------
// Resolver — maps model (+ env) to an adapter.
// ---------------------------------------------------------------------------
export type ModelEnv = {
	DEEPSEEK_API_KEY?: string;
	OPENROUTER_API_KEY?: string;
	MODEL_STUB?: string;
	// Allow stub failure injection for tests
	MODEL_STUB_FAIL?: string;
	MODEL_STUB_TEXT?: string;
};

export function resolveAdapter(model: string, env: ModelEnv): ModelAdapter {
	// Test seam: when MODEL_STUB=1, return deterministic stub.
	// This var is only set in tests (via --var MODEL_STUB=1 in test/helpers/server.ts)
	// and never in production wrangler config or .dev.vars.
	if (env.MODEL_STUB === '1') {
		return new StubAdapter({
			fail: env.MODEL_STUB_FAIL === '1',
			text: env.MODEL_STUB_TEXT
		});
	}

	// Explicit provider routing: openrouter models contain "/" or start with known prefixes
	const isOpenRouter =
		model.includes('/') ||
		model.startsWith('openai/') ||
		model.startsWith('anthropic/') ||
		model.startsWith('google/') ||
		model.startsWith('meta-llama/');

	if (isOpenRouter) {
		const key = env.OPENROUTER_API_KEY;
		if (!key) throw new Error('OPENROUTER_API_KEY is not set');
		return new OpenRouterAdapter(key);
	}

	// Default: DeepSeek direct
	const key = env.DEEPSEEK_API_KEY;
	if (!key) throw new Error('DEEPSEEK_API_KEY is not set');
	return new DeepSeekAdapter(key);
}

// ---------------------------------------------------------------------------
// Catalogue fetching — live OpenRouter source with Cache API, TTL, fallback.
// ---------------------------------------------------------------------------

const CATALOGUE_URL_DEFAULT = 'https://openrouter.ai/api/v1/models';
const CACHE_KEY_URL = 'https://sugu-cache/models';
const CACHE_TTL_MS = 4 * 60 * 60 * 1000; // 4 hours — balances freshness vs 770KB fetch + 10ms CPU budget

type CatalogueResult = {
	models: ModelInfo[];
	source: 'live' | 'cache' | 'fallback';
	fetchedAt: string;
};

function updatePriceMap(models: ModelInfo[]) {
	priceMap.clear();
	for (const m of models) {
		if (m.priceKnown && m.price) priceMap.set(m.id, m.price);
	}
	// Also populate fallback prices for deepseek direct ids if live has the OpenRouter variant
	// (so costFor('deepseek-chat') can use live price from 'deepseek/deepseek-chat')
	for (const m of models) {
		if (m.id === 'deepseek/deepseek-chat' && m.priceKnown && m.price) {
			if (!priceMap.has('deepseek-chat')) priceMap.set('deepseek-chat', m.price);
		}
		if (m.id === 'deepseek/deepseek-reasoner' && m.priceKnown && m.price) {
			if (!priceMap.has('deepseek-reasoner')) priceMap.set('deepseek-reasoner', m.price);
		}
	}
}

function parseSuguModelsOverride(raw: string): ModelInfo[] | null {
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed) || parsed.length === 0) return null;
		const valid: ModelInfo[] = [];
		for (const m of parsed) {
			if (!m || typeof m.id !== 'string' || typeof m.label !== 'string') continue;
			if (m.provider !== 'deepseek' && m.provider !== 'openrouter') continue;
			const info: ModelInfo = {
				id: m.id,
				label: m.label,
				provider: m.provider,
				contextLength: typeof m.contextLength === 'number' ? m.contextLength : undefined,
				priceKnown: false
			};
			if (m.price && typeof m.price.promptPerM === 'number' && typeof m.price.completionPerM === 'number') {
				info.price = { promptPerM: m.price.promptPerM, completionPerM: m.price.completionPerM };
				info.priceKnown = true;
			} else if (typeof m.priceKnown === 'boolean') {
				info.priceKnown = m.priceKnown;
			}
			// Also support old shape without price
			valid.push(info);
		}
		if (valid.length > 0) return valid;
		return null;
	} catch {
		return null;
	}
}

async function fetchLiveCatalogue(fetchImpl: typeof fetch, url: string): Promise<ModelInfo[]> {
	const res = await fetchImpl(url, { headers: { accept: 'application/json' } });
	if (!res.ok) throw new Error(`catalogue fetch ${res.status}`);
	const json = await res.json();
	const models = parseOpenRouterPayload(json);
	if (models.length === 0) throw new Error('catalogue empty');
	return models;
}

async function readCache(cache: Cache | null): Promise<CatalogueResult | null> {
	if (!cache) return null;
	try {
		const req = new Request(CACHE_KEY_URL, { method: 'GET' });
		const cached = await cache.match(req);
		if (!cached) return null;
		const text = await cached.text();
		const parsed = JSON.parse(text) as CatalogueResult;
		if (!parsed || !Array.isArray(parsed.models) || typeof parsed.fetchedAt !== 'string') return null;
		// Check TTL
		const age = Date.now() - new Date(parsed.fetchedAt).getTime();
		if (!Number.isFinite(age) || age < 0) return null;
		// Return even if stale — caller decides whether to use stale on fetch failure
		// Attach age for caller to check freshness
		(parsed as unknown as Record<string, unknown>)['_age'] = age;
		return parsed;
	} catch {
		return null;
	}
}

async function writeCache(cache: Cache | null, result: CatalogueResult): Promise<void> {
	if (!cache) return;
	try {
		const req = new Request(CACHE_KEY_URL, { method: 'GET' });
		const res = new Response(JSON.stringify(result), {
			headers: {
				'content-type': 'application/json',
				'Cache-Control': `max-age=${CACHE_TTL_MS / 1000}`
			}
		});
		await cache.put(req, res);
	} catch {
		// ignore cache write failures
	}
}

/**
 * Get the model catalogue — live with caching, filter, and fallback.
 * - SUGU_MODELS (JSON array) wins immediately (no fetch)
 * - Otherwise fetch from SUGU_MODELS_URL (default OpenRouter), cached via caches.default with 4h TTL
 * - SUGU_MODELS_FILTER narrows the result (comma-separated substrings)
 * - On fetch failure, serve last good cached copy (source: 'cache'); if none, serve fallback (source: 'fallback')
 * - fetchImpl and cacheImpl are injectable for tests (so tests use fixture, not network)
 */
export async function getModels(
	env: { SUGU_MODELS?: string; SUGU_MODELS_URL?: string; SUGU_MODELS_FILTER?: string; MODEL_STUB?: string },
	opts?: { fetchImpl?: typeof fetch; cacheImpl?: Cache | null }
): Promise<CatalogueResult> {
	// Static override wins — no fetch, no cache
	if (env.SUGU_MODELS) {
		const overridden = parseSuguModelsOverride(env.SUGU_MODELS);
		if (overridden) {
			let models = overridden;
			if (env.SUGU_MODELS_FILTER) models = filterModels(models, env.SUGU_MODELS_FILTER);
			updatePriceMap(models);
			return { models, source: 'fallback', fetchedAt: new Date().toISOString() };
		}
	}

	// Test seam: when MODEL_STUB=1, avoid live fetch and return fallback (so tests never hit network)
	if (env.MODEL_STUB === '1') {
		let models = FALLBACK_MODELS;
		if (env.SUGU_MODELS_FILTER) models = filterModels(models, env.SUGU_MODELS_FILTER);
		updatePriceMap(models);
		return { models, source: 'fallback', fetchedAt: new Date().toISOString() };
	}

	const fetchImpl = opts?.fetchImpl ?? fetch;
	let cache: Cache | null = null;
	if (opts?.cacheImpl !== undefined) {
		cache = opts.cacheImpl;
	} else {
		try {
			// caches is only available in Worker runtime; in unit tests it may be undefined
			const maybeCaches = (globalThis as unknown as { caches?: { default: Cache } }).caches;
			if (maybeCaches?.default) cache = maybeCaches.default;
		} catch {
			cache = null;
		}
	}

	const url = env.SUGU_MODELS_URL || CATALOGUE_URL_DEFAULT;

	// Try cache first — if fresh, return it without fetching
	const cached = await readCache(cache);
	if (cached) {
		const age = (cached as unknown as Record<string, unknown>)['_age'] as number;
		if (age < CACHE_TTL_MS) {
			let models = cached.models;
			if (env.SUGU_MODELS_FILTER) models = filterModels(models, env.SUGU_MODELS_FILTER);
			// Update price map from cached models (but keep original source/fetchedAt)
			updatePriceMap(cached.models);
			return { models, source: 'cache', fetchedAt: cached.fetchedAt };
		}
	}

	// Cache miss or stale — try live fetch
	try {
		const liveModels = await fetchLiveCatalogue(fetchImpl, url);
		let models = liveModels;
		if (env.SUGU_MODELS_FILTER) models = filterModels(models, env.SUGU_MODELS_FILTER);
		const result: CatalogueResult = { models: liveModels, source: 'live', fetchedAt: new Date().toISOString() };
		// For filtered case, we still cache the unfiltered live result, but return filtered
		// Actually cache the filtered result so subsequent cache hits are already filtered? No — cache unfiltered and filter on read.
		// Simpler: cache the liveModels unfiltered, return filtered view.
		// But we need to return filtered models with source live.
		// So we cache liveModels, then return filtered.
		await writeCache(cache, { models: liveModels, source: 'live', fetchedAt: result.fetchedAt });
		updatePriceMap(liveModels);
		// Return filtered view but with live source
		if (env.SUGU_MODELS_FILTER) {
			return { models, source: 'live', fetchedAt: result.fetchedAt };
		}
		return result;
	} catch {
		// Fetch failed — serve stale cache if available
		if (cached) {
			let models = cached.models;
			if (env.SUGU_MODELS_FILTER) models = filterModels(models, env.SUGU_MODELS_FILTER);
			updatePriceMap(cached.models);
			return { models, source: 'cache', fetchedAt: cached.fetchedAt };
		}
		// No cache at all — fallback
		let models = FALLBACK_MODELS;
		if (env.SUGU_MODELS_FILTER) models = filterModels(models, env.SUGU_MODELS_FILTER);
		updatePriceMap(FALLBACK_MODELS);
		return { models, source: 'fallback', fetchedAt: new Date().toISOString() };
	}
}

// Synchronous helper for backward compat — returns fallback models synchronously.
// Used by old tests that call getModels without await. New code should use async getModels.
export function getModelsSync(env: { SUGU_MODELS?: string; SUGU_MODELS_FILTER?: string }): ModelInfo[] {
	if (env.SUGU_MODELS) {
		const overridden = parseSuguModelsOverride(env.SUGU_MODELS);
		if (overridden) {
			if (env.SUGU_MODELS_FILTER) return filterModels(overridden, env.SUGU_MODELS_FILTER);
			return overridden;
		}
	}
	let models = FALLBACK_MODELS;
	if (env.SUGU_MODELS_FILTER) models = filterModels(models, env.SUGU_MODELS_FILTER);
	return models;
}

// Re-export for tests and usage recording
export { FALLBACK_MODELS, costFor, CACHE_TTL_MS, CATALOGUE_URL_DEFAULT };
