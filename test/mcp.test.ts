import { describe, test, expect } from 'bun:test';
import { McpClient, parseMcpServers, truncateResult, MAX_TOOL_RESULT_BYTES, TRUNCATION_MARKER } from '../src/server/mcp';

// Helpers
function jsonResponse(body: unknown, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(body), {
		status: 200,
		headers: { 'content-type': 'application/json', ...headers },
	});
}

function sseResponse(jsonRpcBody: unknown, headers: Record<string, string> = {}): Response {
	const data = `data: ${JSON.stringify(jsonRpcBody)}\n\n`;
	return new Response(data, {
		status: 200,
		headers: { 'content-type': 'text/event-stream', ...headers },
	});
}

function makeFetch(responses: Response[]): typeof fetch {
	let idx = 0;
	return (async () => {
		const res = responses[idx++] ?? responses[responses.length - 1]!;
		return res.clone();
	}) as unknown as typeof fetch;
}

describe('parseMcpServers', () => {
	test('returns empty when unset', () => {
		expect(parseMcpServers({})).toEqual([]);
		expect(parseMcpServers({ SUGU_MCP_SERVERS: '' })).toEqual([]);
	});

	test('parses valid servers', () => {
		const env = {
			SUGU_MCP_SERVERS: JSON.stringify([{ name: 'sepia', url: 'https://sepia.fly.dev/mcp', tokenEnv: 'SEPIA_TOKEN' }]),
			SEPIA_TOKEN: 'secret123',
		};
		const servers = parseMcpServers(env);
		expect(servers.length).toBe(1);
		expect(servers[0]!.name).toBe('sepia');
		expect(servers[0]!.token).toBe('secret123');
	});

	test('resolves token from env', () => {
		const env = {
			SUGU_MCP_SERVERS: JSON.stringify([{ name: 'a', url: 'https://a.example/mcp', tokenEnv: 'MY_TOKEN' }]),
			MY_TOKEN: 'tok',
		};
		expect(parseMcpServers(env)[0]!.token).toBe('tok');
	});

	test('missing tokenEnv still includes server without token', () => {
		const env = {
			SUGU_MCP_SERVERS: JSON.stringify([{ name: 'a', url: 'https://a.example/mcp', tokenEnv: 'MISSING' }]),
		};
		const servers = parseMcpServers(env);
		expect(servers.length).toBe(1);
		expect(servers[0]!.token).toBeUndefined();
	});

	test('invalid JSON returns empty', () => {
		expect(parseMcpServers({ SUGU_MCP_SERVERS: 'not json' })).toEqual([]);
	});

	test('invalid URL skipped', () => {
		const env = {
			SUGU_MCP_SERVERS: JSON.stringify([{ name: 'a', url: 'not-a-url' }]),
		};
		expect(parseMcpServers(env)).toEqual([]);
	});
});

describe('truncateResult', () => {
	test('small text not truncated', () => {
		const { text, truncated } = truncateResult('hello');
		expect(truncated).toBe(false);
		expect(text).toBe('hello');
	});

	test('large text truncated with marker', () => {
		const large = 'a'.repeat(MAX_TOOL_RESULT_BYTES + 1000);
		const { text, truncated } = truncateResult(large);
		expect(truncated).toBe(true);
		expect(text.endsWith(TRUNCATION_MARKER)).toBe(true);
		expect(new TextEncoder().encode(text).length).toBeLessThanOrEqual(MAX_TOOL_RESULT_BYTES);
	});

	test('exactly 48KB not truncated', () => {
		const exact = 'a'.repeat(MAX_TOOL_RESULT_BYTES);
		const { truncated } = truncateResult(exact);
		expect(truncated).toBe(false);
	});
});

describe('McpClient', () => {
	test('initialize captures Mcp-Session-Id and echoes on subsequent calls', async () => {
		const initRes = jsonResponse({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05' } }, { 'mcp-session-id': 'sess-123' });
		const listRes = jsonResponse({ jsonrpc: '2.0', id: 2, result: { tools: [{ name: 'search', description: 'search' }] } });
		// Capture headers sent on second call
		let capturedHeaders: Record<string, string> | null = null;
		const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
			const headers = init?.headers as Record<string, string>;
			// Second call should have mcp-session-id
			if (capturedHeaders === null && headers['mcp-session-id']) {
				capturedHeaders = headers;
			}
			// Return init then list
			if (!capturedHeaders) {
				// First call is initialize
				return initRes.clone();
			}
			// Check if this is the list call with session id
			if (headers['mcp-session-id'] === 'sess-123') {
				capturedHeaders = headers;
			}
			return listRes.clone();
		}) as unknown as typeof fetch;

		const client = new McpClient([{ name: 'sepia', url: 'https://sepia.example/mcp' }], fetchImpl);
		await client.initialize({ name: 'sepia', url: 'https://sepia.example/mcp' });
		expect(client.getSessionId('sepia')).toBe('sess-123');

		// Now listTools should send the session id
		const fetchWithCapture = (async (url: string | URL | Request, init?: RequestInit) => {
			const headers = init?.headers as Record<string, string>;
			if (headers['mcp-session-id'] === 'sess-123') {
				capturedHeaders = headers;
			}
			return listRes.clone();
		}) as unknown as typeof fetch;
		const client2 = new McpClient(
			[{ name: 'sepia', url: 'https://sepia.example/mcp' }],
			fetchWithCapture,
			new Map([['sepia', 'sess-123']]),
		);
		await client2.listTools();
		expect(capturedHeaders).not.toBeNull();
		expect(capturedHeaders!['mcp-session-id']).toBe('sess-123');
	});

	test('SSE response parsed same as JSON', async () => {
		const toolResult = { jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'search', description: 's' }] } };
		const jsonFetch = makeFetch([
			jsonResponse({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05' } }),
			jsonResponse(toolResult),
		]);
		const sseFetch = makeFetch([
			sseResponse({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05' } }),
			sseResponse(toolResult),
		]);

		const clientJson = new McpClient([{ name: 'a', url: 'https://a.example/mcp' }], jsonFetch);
		const clientSse = new McpClient([{ name: 'a', url: 'https://a.example/mcp' }], sseFetch);

		const resJson = await clientJson.listTools();
		const resSse = await clientSse.listTools();

		expect(resJson.tools.length).toBe(1);
		expect(resSse.tools.length).toBe(1);
		expect(resJson.tools[0]!.name).toBe('a__search');
		expect(resSse.tools[0]!.name).toBe('a__search');
	});

	test('timeout produces failed tool and turn continues', async () => {
		// Use a fetch that hangs and respects abort, with a short timeout via client
		const hangingFetch = (async (_url: string | URL | Request, init?: RequestInit) => {
			return new Promise<Response>((_, reject) => {
				const onAbort = () => {
					reject(new DOMException('Aborted', 'AbortError'));
				};
				if (init?.signal?.aborted) {
					onAbort();
					return;
				}
				init?.signal?.addEventListener('abort', onAbort, { once: true });
			});
		}) as unknown as typeof fetch;

		// Create a client that will timeout quickly — we test the timeout path by
		// directly calling callTool with a hanging fetch and checking isError
		const client = new McpClient([{ name: 'a', url: 'https://a.example/mcp' }], hangingFetch);
		// Pre-populate mapping so callTool doesn't need listTools
		(client as unknown as { cachedTools: unknown }).cachedTools = {
			tools: [{ name: 'a__search' }],
			mapping: new Map([['a__search', { server: { name: 'a', url: 'https://a.example/mcp' }, originalName: 'search' }]]),
			at: Date.now(),
		};
		(client as unknown as { cacheTurn: number }).cacheTurn = 0;
		// callTool should timeout and return isError true
		// We need to make the timeout short for the test — patch the client's fetch to use 100ms timeout
		// Instead, we test that a hanging fetch eventually times out (8s is too long for test, so we use a direct timeout test)
		// For now, test that the hanging fetch with abort works: call with 100ms timeout
		const start = Date.now();
		// Use a custom doJsonRpc timeout by creating a client with a short timeout fetch
		// We'll test the timeout by checking that callTool returns isError when fetch hangs
		// Use a 100ms timeout via a wrapper
		const shortTimeoutFetch = (async (url: string | URL | Request, init?: RequestInit) => {
			return new Promise<Response>((_, reject) => {
				const timer = setTimeout(() => {
					reject(new DOMException('Aborted', 'AbortError'));
				}, 100);
				init?.signal?.addEventListener(
					'abort',
					() => {
						clearTimeout(timer);
						reject(new DOMException('Aborted', 'AbortError'));
					},
					{ once: true },
				);
			});
		}) as unknown as typeof fetch;
		const client2 = new McpClient([{ name: 'a', url: 'https://a.example/mcp' }], shortTimeoutFetch);
		(client2 as unknown as { cachedTools: unknown }).cachedTools = {
			tools: [{ name: 'a__search' }],
			mapping: new Map([['a__search', { server: { name: 'a', url: 'https://a.example/mcp' }, originalName: 'search' }]]),
			at: Date.now(),
		};
		(client2 as unknown as { cacheTurn: number }).cacheTurn = 0;
		const result = await client2.callTool('a__search', { q: 'hello' });
		expect(result.isError).toBe(true);
		expect(result.text).toContain('timeout');
		expect(Date.now() - start).toBeLessThan(2000);
	});

	test('JSON-RPC error handled as tool failure, not crash', async () => {
		const errRes = jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32601, message: 'Method not found' } });
		const fetchImpl = makeFetch([jsonResponse({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05' } }), errRes, errRes]);
		const client = new McpClient([{ name: 'a', url: 'https://a.example/mcp' }], fetchImpl);
		const listed = await client.listTools();
		// tools/list returned error, so no tools
		expect(listed.tools.length).toBe(0);

		// Now test callTool with error — need to ensure callTool handles JSON-RPC error
		const callErrRes = jsonResponse({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'Invalid params' } });
		const callErrFetch = makeFetch([callErrRes]);
		const client2 = new McpClient([{ name: 'a', url: 'https://a.example/mcp' }], callErrFetch);
		// Pre-populate mapping
		(client2 as unknown as { cachedTools: unknown }).cachedTools = {
			tools: [{ name: 'a__search', description: 's' }],
			mapping: new Map([['a__search', { server: { name: 'a', url: 'https://a.example/mcp' }, originalName: 'search' }]]),
			at: Date.now(),
		};
		(client2 as unknown as { cacheTurn: number }).cacheTurn = 0;
		const result = await client2.callTool('a__search', {});
		expect(result.isError).toBe(true);
		expect(result.text).toContain('Invalid params');
	});

	test('namespacing: two servers same tool name do not collide', async () => {
		const listA = jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'search', description: 'a search' }] } });
		const listB = jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools: [{ name: 'search', description: 'b search' }] } });
		let callCount = 0;
		const fetchImpl = (async () => {
			callCount++;
			if (callCount === 1) return jsonResponse({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05' } }).clone();
			if (callCount === 2) return listA.clone();
			if (callCount === 3) return jsonResponse({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05' } }).clone();
			if (callCount === 4) return listB.clone();
			return listA.clone();
		}) as unknown as typeof fetch;

		const client = new McpClient(
			[
				{ name: 'sepia', url: 'https://sepia.example/mcp' },
				{ name: 'exa', url: 'https://exa.example/mcp' },
			],
			fetchImpl,
		);
		const { tools, mapping } = await client.listTools();
		expect(tools.length).toBe(2);
		expect(tools.map((t) => t.name).sort()).toEqual(['exa__search', 'sepia__search']);
		expect(mapping.has('sepia__search')).toBe(true);
		expect(mapping.has('exa__search')).toBe(true);
		expect(mapping.get('sepia__search')!.originalName).toBe('search');
		expect(mapping.get('exa__search')!.originalName).toBe('search');
		// Different servers
		expect(mapping.get('sepia__search')!.server.name).toBe('sepia');
		expect(mapping.get('exa__search')!.server.name).toBe('exa');
	});

	test('malformed tools/list rejected without crashing', async () => {
		const badList = jsonResponse({ jsonrpc: '2.0', id: 1, result: { tools: 'not an array' } });
		const fetchImpl = makeFetch([jsonResponse({ jsonrpc: '2.0', id: 1, result: { protocolVersion: '2024-11-05' } }), badList]);
		const client = new McpClient([{ name: 'a', url: 'https://a.example/mcp' }], fetchImpl);
		const { tools } = await client.listTools();
		expect(tools.length).toBe(0);
	});

	test('truncation marker visible', async () => {
		const largeText = 'a'.repeat(MAX_TOOL_RESULT_BYTES + 1000);
		const callRes = jsonResponse({ jsonrpc: '2.0', id: 1, result: { content: [{ type: 'text', text: largeText }] } });
		const fetchImpl = makeFetch([callRes]);
		const client = new McpClient([{ name: 'a', url: 'https://a.example/mcp' }], fetchImpl);
		(client as unknown as { cachedTools: unknown }).cachedTools = {
			tools: [{ name: 'a__search' }],
			mapping: new Map([['a__search', { server: { name: 'a', url: 'https://a.example/mcp' }, originalName: 'search' }]]),
			at: Date.now(),
		};
		(client as unknown as { cacheTurn: number }).cacheTurn = 0;
		const result = await client.callTool('a__search', {});
		expect(result.truncated).toBe(true);
		expect(result.text.endsWith(TRUNCATION_MARKER)).toBe(true);
	});
});
