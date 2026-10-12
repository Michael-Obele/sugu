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
		signal: AbortSignal,
	): AsyncIterable<{ delta?: string; toolCall?: ToolCall; usage?: Usage }>;
}

// ---------------------------------------------------------------------------
// Pricing table — single source of truth, needs periodic verification.
// Unknown model => cost 0 (do not throw).
// Prices are USD per 1M tokens. Last verified: 2026-10-12 against provider pages.
// ---------------------------------------------------------------------------
const PRICE_TABLE: Record<string, { prompt: number; completion: number }> = {
	// DeepSeek
	'deepseek-chat': { prompt: 0.27, completion: 1.1 },
	'deepseek-reasoner': { prompt: 0.55, completion: 2.19 },
	// OpenRouter — common models (representative; drifts, verify periodically)
	'openai/gpt-4o': { prompt: 2.5, completion: 10 },
	'openai/gpt-4o-mini': { prompt: 0.15, completion: 0.6 },
	'anthropic/claude-3.5-sonnet': { prompt: 3, completion: 15 },
	'google/gemini-2.0-flash-001': { prompt: 0.1, completion: 0.4 },
	'meta-llama/llama-3.1-70b-instruct': { prompt: 0.59, completion: 0.79 },
};

function costFor(model: string, promptT: number, complT: number): number {
	const entry = PRICE_TABLE[model];
	if (!entry) return 0;
	return (promptT * entry.prompt + complT * entry.completion) / 1_000_000;
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
export async function* parseSseStream(
	stream: ReadableStream<Uint8Array>,
	signal?: AbortSignal,
): AsyncIterable<SseEvent> {
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
		try { reader.releaseLock(); } catch {}
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

function buildRequestBody(
	model: string,
	messages: Msg[],
	tools?: ToolDef[],
	maxTokens?: number,
): Record<string, unknown> {
	const body: Record<string, unknown> = {
		model,
		messages: messages.map((m) => ({ role: m.role, content: m.content })),
		stream: true,
	};
	if (maxTokens !== undefined) body['max_tokens'] = maxTokens;
	if (tools && tools.length > 0) {
		body['tools'] = tools.map((t) => ({
			type: 'function',
			function: { name: t.name, description: t.description ?? '', parameters: t.parameters ?? {} },
		}));
	}
	return body;
}

async function* streamFromSse(
	response: Response,
	signal: AbortSignal,
	model: string,
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
								arguments: (fn?.['arguments'] as string) ?? '',
							},
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
		signal: AbortSignal,
	): AsyncIterable<{ delta?: string; toolCall?: ToolCall; usage?: Usage }> {
		const body = buildRequestBody(req.model, req.messages, req.tools, req.maxTokens);
		const res = await fetch('https://api.deepseek.com/chat/completions', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${this.apiKey}`,
			},
			body: JSON.stringify(body),
			signal,
		});
		yield* streamFromSse(res, signal, req.model);
	}
}

class OpenRouterAdapter implements ModelAdapter {
	constructor(private apiKey: string) {}
	async *stream(
		req: { model: string; messages: Msg[]; tools?: ToolDef[]; maxTokens?: number },
		signal: AbortSignal,
	): AsyncIterable<{ delta?: string; toolCall?: ToolCall; usage?: Usage }> {
		const body = buildRequestBody(req.model, req.messages, req.tools, req.maxTokens);
		const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
			method: 'POST',
			headers: {
				'content-type': 'application/json',
				authorization: `Bearer ${this.apiKey}`,
				'http-referer': 'https://sugu.app',
				'x-title': 'Sugu',
			},
			body: JSON.stringify(body),
			signal,
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
		signal: AbortSignal,
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
			text: env.MODEL_STUB_TEXT,
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

// Re-export pricing for usage recording
export { PRICE_TABLE, costFor };


// ---------------------------------------------------------------------------
// Model catalogue — single source of truth, overridable via SUGU_MODELS env.
// ---------------------------------------------------------------------------

export type ModelInfo = { id: string; label: string; provider: 'deepseek' | 'openrouter' };

const DEFAULT_MODELS: ModelInfo[] = [
	{ id: 'deepseek-chat', label: 'DeepSeek Chat', provider: 'deepseek' },
	{ id: 'deepseek-reasoner', label: 'DeepSeek Reasoner', provider: 'deepseek' },
	{ id: 'openai/gpt-4o', label: 'GPT-4o', provider: 'openrouter' },
	{ id: 'openai/gpt-4o-mini', label: 'GPT-4o mini', provider: 'openrouter' },
	{ id: 'anthropic/claude-3.5-sonnet', label: 'Claude 3.5 Sonnet', provider: 'openrouter' },
	{ id: 'google/gemini-2.0-flash-001', label: 'Gemini 2.0 Flash', provider: 'openrouter' },
	{ id: 'meta-llama/llama-3.1-70b-instruct', label: 'Llama 3.1 70B', provider: 'openrouter' },
];

export function getModels(env: { SUGU_MODELS?: string }): ModelInfo[] {
	const raw = env.SUGU_MODELS;
	if (raw) {
		try {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed) && parsed.length > 0) {
				const valid: ModelInfo[] = [];
				for (const m of parsed) {
					if (
						m &&
						typeof m.id === 'string' &&
						typeof m.label === 'string' &&
						(m.provider === 'deepseek' || m.provider === 'openrouter')
					) {
						valid.push({ id: m.id, label: m.label, provider: m.provider });
					}
				}
				if (valid.length > 0) return valid;
			}
		} catch {
			// fall through to default
		}
	}
	return DEFAULT_MODELS;
}

export { DEFAULT_MODELS };
