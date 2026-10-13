/**
 * Minimal MCP Streamable HTTP client — hand-rolled, no SDK.
 * Implements the three-call subset: initialize, tools/list, tools/call.
 * Handles both application/json and text/event-stream responses.
 * 8s timeout → tool failed, turn continues, no retries.
 * Config-driven via SUGU_MCP_SERVERS, namespaced tool names, AR-4 truncation.
 */

import * as v from 'valibot';

export const MCP_TIMEOUT_MS = 8000;
export const MAX_TOOL_RESULT_BYTES = 48 * 1024;
export const TRUNCATION_MARKER = '\n…[truncated to 48KB]';

const McpToolSchema = v.strictObject({
	name: v.string(),
	description: v.optional(v.string()),
	inputSchema: v.optional(v.unknown()),
});

const ToolsListResultSchema = v.strictObject({
	tools: v.array(McpToolSchema),
});

export type McpServerConfig = { name: string; url: string; tokenEnv?: string };
export type ResolvedServer = { name: string; url: string; token?: string };

export function parseMcpServers(env: Record<string, string | undefined>): ResolvedServer[] {
	const raw = env['SUGU_MCP_SERVERS'];
	if (!raw || raw.trim() === '') return [];
	try {
		const parsed = JSON.parse(raw);
		if (!Array.isArray(parsed)) return [];
		const out: ResolvedServer[] = [];
		for (const entry of parsed) {
			if (!entry || typeof entry.name !== 'string' || typeof entry.url !== 'string') continue;
			const name = entry.name.trim();
			const url = entry.url.trim();
			if (!name || !url) continue;
			try {
				new URL(url);
			} catch {
				continue;
			}
			let token: string | undefined;
			if (typeof entry.tokenEnv === 'string' && entry.tokenEnv.trim() !== '') {
				const envName = entry.tokenEnv.trim();
				token = env[envName];
			}
			out.push({ name, url, token });
		}
		return out;
	} catch {
		return [];
	}
}

export function truncateResult(text: string): { text: string; truncated: boolean } {
	const bytes = new TextEncoder().encode(text).length;
	if (bytes <= MAX_TOOL_RESULT_BYTES) return { text, truncated: false };
	const markerBytes = new TextEncoder().encode(TRUNCATION_MARKER).length;
	const budget = MAX_TOOL_RESULT_BYTES - markerBytes;
	let low = 0;
	let high = text.length;
	const enc = new TextEncoder();
	while (low < high) {
		const mid = Math.floor((low + high + 1) / 2);
		if (enc.encode(text.slice(0, mid)).length <= budget) low = mid;
		else high = mid - 1;
	}
	return { text: text.slice(0, low) + TRUNCATION_MARKER, truncated: true };
}

async function doJsonRpc(
	server: ResolvedServer,
	method: string,
	params: unknown,
	fetchImpl: typeof fetch,
	sessionIds: Map<string, string>,
	timeoutMs = MCP_TIMEOUT_MS,
): Promise<unknown> {
	const id = Math.floor(Math.random() * 1_000_000);
	const body = { jsonrpc: '2.0' as const, id, method, params };
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		accept: 'application/json, text/event-stream',
	};
	if (server.token) headers['authorization'] = `Bearer ${server.token}`;
	const sid = sessionIds.get(server.name);
	if (sid) headers['mcp-session-id'] = sid;

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), timeoutMs);
	try {
		const res = await fetchImpl(server.url, {
			method: 'POST',
			headers,
			body: JSON.stringify(body),
			signal: controller.signal,
		});

		const newSid =
			res.headers.get('mcp-session-id') ?? res.headers.get('Mcp-Session-Id') ?? res.headers.get('mcp-session-id'.toLowerCase());
		if (newSid) sessionIds.set(server.name, newSid);

		if (!res.ok) {
			const text = await res.text().catch(() => '');
			throw new Error(`MCP HTTP ${res.status}: ${text.slice(0, 500)}`);
		}

		const ct = res.headers.get('content-type') ?? '';
		let json: unknown;
		if (ct.includes('text/event-stream')) {
			const text = await res.text();
			const lines = text.split('\n');
			let dataPayload: string | null = null;
			for (const line of lines) {
				if (line.startsWith('data:')) {
					const data = line.slice(5).trim();
					if (data && data !== '[DONE]') {
						dataPayload = data;
						break;
					}
				}
			}
			if (dataPayload === null) {
				try {
					json = JSON.parse(text);
				} catch {
					throw new Error('SSE response missing data');
				}
			} else {
				json = JSON.parse(dataPayload);
			}
		} else {
			const text = await res.text();
			try {
				json = JSON.parse(text);
			} catch {
				throw new Error(`Invalid JSON response: ${text.slice(0, 500)}`);
			}
		}

		const rpc = json as {
			jsonrpc?: string;
			id?: unknown;
			result?: unknown;
			error?: { code: number; message: string };
		};
		if (rpc.error) {
			throw new Error(`JSON-RPC error ${rpc.error.code}: ${rpc.error.message}`);
		}
		return rpc.result;
	} catch (e) {
		if ((e as Error).name === 'AbortError') {
			throw new Error(`MCP timeout after ${timeoutMs}ms`);
		}
		throw e;
	} finally {
		clearTimeout(timer);
	}
}

export type McpToolDef = { name: string; description?: string; inputSchema?: unknown };

export class McpClient {
	private servers: ResolvedServer[];
	private fetchImpl: typeof fetch;
	private sessionIds: Map<string, string>;
	private cachedTools: {
		tools: McpToolDef[];
		mapping: Map<string, { server: ResolvedServer; originalName: string }>;
		at: number;
	} | null = null;
	private cacheTurn = -1;
	private turnCounter = 0;

	constructor(servers: ResolvedServer[], fetchImpl: typeof fetch = fetch, sessionIds?: Map<string, string>) {
		this.servers = servers;
		this.fetchImpl = fetchImpl;
		this.sessionIds = sessionIds ?? new Map();
	}

	getSessionId(serverName: string): string | undefined {
		return this.sessionIds.get(serverName);
	}

	async initialize(server: ResolvedServer): Promise<void> {
		try {
			await doJsonRpc(
				server,
				'initialize',
				{
					protocolVersion: '2024-11-05',
					capabilities: {},
					clientInfo: { name: 'sugu', version: '0.0.0' },
				},
				this.fetchImpl,
				this.sessionIds,
			);
		} catch {
			// Initialize failure is not fatal — continue without session id
		}
	}

	async listTools(): Promise<{
		tools: McpToolDef[];
		mapping: Map<string, { server: ResolvedServer; originalName: string }>;
	}> {
		if (this.cachedTools && this.cacheTurn === this.turnCounter) {
			return { tools: this.cachedTools.tools, mapping: this.cachedTools.mapping };
		}

		const allTools: McpToolDef[] = [];
		const mapping = new Map<string, { server: ResolvedServer; originalName: string }>();

		for (const server of this.servers) {
			if (!this.sessionIds.has(server.name)) {
				await this.initialize(server);
			}
			try {
				const result = (await doJsonRpc(server, 'tools/list', {}, this.fetchImpl, this.sessionIds)) as unknown;
				const parsed = v.safeParse(ToolsListResultSchema, result);
				if (!parsed.success) {
					continue;
				}
				for (const tool of parsed.output.tools) {
					const namespaced = `${server.name}__${tool.name}`;
					if (mapping.has(namespaced)) continue;
					const def: McpToolDef = {
						name: namespaced,
						description: tool.description,
						inputSchema: tool.inputSchema,
					};
					allTools.push(def);
					mapping.set(namespaced, { server, originalName: tool.name });
				}
			} catch {
				continue;
			}
		}

		this.cachedTools = { tools: allTools, mapping, at: Date.now() };
		this.cacheTurn = this.turnCounter;
		return { tools: allTools, mapping };
	}

	nextTurn(): void {
		this.turnCounter++;
	}

	async callTool(
		namespacedName: string,
		args: unknown,
	): Promise<{ text: string; truncated: boolean; isError: boolean; durationMs: number }> {
		const entry = this.cachedTools?.mapping.get(namespacedName);
		let server: ResolvedServer | undefined;
		let originalName: string | undefined;
		if (entry) {
			server = entry.server;
			originalName = entry.originalName;
		} else {
			const idx = namespacedName.indexOf('__');
			if (idx !== -1) {
				const prefix = namespacedName.slice(0, idx);
				const orig = namespacedName.slice(idx + 2);
				const srv = this.servers.find((s) => s.name === prefix);
				if (srv) {
					server = srv;
					originalName = orig;
				}
			}
			if (!server || !originalName) {
				throw new Error(`Unknown tool: ${namespacedName}`);
			}
		}

		const start = Date.now();
		try {
			const result = (await doJsonRpc(
				server!,
				'tools/call',
				{ name: originalName, arguments: args },
				this.fetchImpl,
				this.sessionIds,
			)) as unknown as { content?: Array<{ type: string; text?: string }>; isError?: boolean } | { content?: string } | unknown;

			let text: string;
			let isError = false;
			if (result && typeof result === 'object' && 'content' in (result as Record<string, unknown>)) {
				const r = result as { content?: unknown; isError?: boolean };
				isError = !!r.isError;
				if (Array.isArray(r.content)) {
					text = (r.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('\n');
				} else if (typeof r.content === 'string') {
					text = r.content;
				} else {
					text = JSON.stringify(r.content);
				}
			} else if (typeof result === 'string') {
				text = result;
			} else {
				text = JSON.stringify(result);
			}

			const truncated = truncateResult(text);
			const durationMs = Date.now() - start;
			return { text: truncated.text, truncated: truncated.truncated, isError, durationMs };
		} catch (e) {
			const durationMs = Date.now() - start;
			const msg = e instanceof Error ? e.message : String(e);
			const truncated = truncateResult(msg);
			return { text: truncated.text, truncated: truncated.truncated, isError: true, durationMs };
		}
	}
}
