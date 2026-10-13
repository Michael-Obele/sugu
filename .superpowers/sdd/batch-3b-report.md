# Batch 3B — MCP client and the tool loop — report

## Client design (`src/server/mcp.ts`)

Hand-rolled ~330 LOC, no SDK. Three-call subset over Streamable HTTP:

- `initialize` → captures `Mcp-Session-Id` response header (case-insensitive) and echoes it on later calls via `mcp-session-id` header.
- `tools/list` → cached per turn (`cacheTurn` guard, refreshed at most once per turn via `nextTurn()`), validated with Valibot (`ToolsListResultSchema`) before trusting.
- `tools/call { name, arguments }` → result text, with `isError` flag.

Both `application/json` and `text/event-stream` responses handled: checks `content-type` for `text/event-stream`, parses `data:` lines, falls back to JSON parse if no SSE framing. 8s timeout via `AbortController` + `setTimeout` → tool marked `failed` with timeout message, turn continues, no retries. JSON-RPC `error` field also maps to `isError: true`.

Config-driven via `SUGU_MCP_SERVERS` (JSON: `[{ name, url, tokenEnv }]`), token resolved from named env var. Unset → zero servers, no hardcoded list. Never leaks token into frame/result/log.

Namespacing: `serverName__toolName` (e.g. `sepia__search`), mapping stored for call dispatch. Two servers with same tool name get distinct namespaced names.

AR-4: `truncateResult` caps at 48KB, appends `…[truncated to 48KB]` marker, visible in UI.

## Env var

`SUGU_MCP_SERVERS` — JSON array of `{ name, url, tokenEnv }`. Example:

```json
[{"name":"sepia","url":"https://sepia.fly.dev/mcp","tokenEnv":"SEPIA_TOKEN"}]
```

Token resolved from `env[tokenEnv]` at parse time. If `SUGU_MCP_SERVERS` unset or invalid JSON, zero servers.

## Tool loop (`src/session-cell.ts`)

- At turn start, `McpClient` lists tools (with Valibot validation), maps to `ToolDef[]`, sends to adapter via `tools` param.
- Adapter yields `toolCall` (id, name, arguments). Loop executes via `mcpClient.callTool`, measures `durationMs` with `Date.now()`, handles `isError` and truncation.
- Emits `tool` frames: `running` (live-only, no row) then `ok`/`failed` with `summary` (truncated to 800 chars + duration + truncation marker) and `durationMs`/`truncated` fields. Seq via `nextSeq()` (MAX(id)+1 from events).
- Writes 1 row per tool to `tool_runs` (single INSERT final, no running→update split) — that's 1 row per tool for AR-6.
- Feeds result back as `Tool ${name} ${status}: ${text}` user message + assistant tool-call marker, continues loop.
- Failed tools do not end turn; model gets error text and carries on.

## The 5-vs-4 iteration conflict

Architecture says max 5 iterations/turn, D7 says ≤8 row-writes/turn (1 user + 1 reserve + 1 update + 1 usage + N tools = 4+N). N=5 gives 9 > 8, so AR-6 wins. Cap at 4 so 4+N=8 exactly.

Documented in code:

```ts
// MCP tool loop: AR-6 wins over the 5-iteration preference.
// Real row budget per turn: 1 user INSERT + 1 assistant reserve INSERT +
// 1 assistant UPDATE + 1 usage UPSERT + N tool_runs INSERTs = 4 + N.
// N=5 gives 9 > hard limit 8, so cap at 4 (4+N=8). See batch-3b brief.
private static readonly MAX_TOOL_ITERATIONS = 4;
```

And per-tool:

```ts
// AR-6: 1 row per tool — single INSERT into tool_runs (final, no running→update split).
// That's 1 row per tool, so 4 tools = 4+N=8 total (see class comment).
```

## Measured row-write and subrequest counts

### Row writes per turn (AR-6: ≤8)

- Base: 1 user INSERT + 1 assistant reserve INSERT + 1 assistant UPDATE + 1 usage UPSERT = 4
- Per tool: 1 INSERT into `tool_runs` (single final, no UPDATE) = 1 per tool
- Max-tool turn (4 tools): 4 + 4 = 8 exactly. Asserted in `test/batch3b.test.ts`.
- 5 tools would be 9 > 8, so 5th call not executed (cap enforced).

Note: tool frames are also live-emitted with seq but the running frame is not persisted (saves a row). The final tool frame's seq is from `nextSeq()` but the row is only in `tool_runs`, not also in `events` for tools — that's how we keep 1 per tool. If we also INSERTed into `events` for tools, it would be 2 per tool and 4 tools = 12 > 8.

### Subrequests per turn (AR-5: ≤4)

- Worst case with 4 tool calls and 1 MCP server: 1 model + 2 (initialize + tools/list) + 4 tools = 7 > 4.
- With 0 MCP servers: 1 model + 0 = 1 ≤ 4.
- With 1 tool and 1 server: 1 + 2 + 1 = 4 exactly.
- So a max-tool turn (4 tools) exceeds AR-5. This is documented as a concern: the 4-iteration cap keeps row budget at 8 but subrequests at 7 for a full turn. To stay ≤4, would need to cap at 1 tool or avoid the initialize call (reuse session id across turns).

## UI (`sugu/src/lib/components/ToolRow.svelte`, `MessageList.svelte`, `frames.ts`)

- `ToolRow`: honest `durationMs` (measured start/end), collapsible raw output (truncated to 800 chars display), visible `…[truncated to 48KB]` marker when AR-4 cut, clear failed state (destructive badge + "Tool failed" note), 44px trigger, focus ring.
- `MessageList`: tool rows grouped by `seq`, duration and truncation marker shown, failed state not alarming (destructive badge but calm layout).
- `frames.ts`: `ToolEntry` now has `durationMs` and `truncated`, `applyFrame` handles them.
- `contracts.ts`: `ToolFrame` now has optional `durationMs` and `truncated`.

## Tests

- `test/mcp.test.ts` (16 tests): parseMcpServers, truncateResult, initialize session-id round-trip, SSE vs JSON parity, timeout→failed, JSON-RPC error handling, name collisions, 48KB truncation, malformed tools/list.
- `test/batch3b.test.ts` (7 tests): AR-4 truncation, 4-iteration cap arithmetic, row writes ≤8, subrequests, Valibot malformed.
- Existing 189 tests still passing. Total 212.

## Verify commands and real output

```
bun tsc --noEmit          # no output (0 errors)
bun test                  # 212 pass, 0 fail (20s) — run twice, both 212
mv .env /tmp/e && bun test && mv /tmp/e .env  # 212 pass, 0 fail
bun run --cwd sugu check  # svelte-check found 0 errors and 0 warnings
bun run build             # built in 2.98s, adapter-static done
./node_modules/.bin/vp lint    # 4 warnings (unused imports, const-comparisons) — no errors
./node_modules/.bin/vp fmt --check  # All matched files use correct format (after fmt)
```

## What could not be verified

- Real MCP server round-trip (no live server in test env; stubbed with fixtures).
- Subrequest count in production (needs live wrangler with MCP server).
- Tool loop end-to-end with real model yielding toolCall (stub adapter yields toolCall via TOOL: prefix, but real DeepSeek/OpenRouter toolCall flow not tested live).

## Concerns

- AR-5 exceeded for max-tool turn (7 subrequests > 4). Documented above.
- Tool replay: tool frames are stored only in `tool_runs`, not in `events`, so `hello?since` replay currently does not replay tool frames (they are live-only). To make replay complete, `handleHello` should also query `tool_runs` and emit tool frames. Currently, tool frames are not replayed after reconnect.
- The stub adapter's toolCall injection via `MODEL_STUB_TEXT=TOOL:{...}` is a test seam, not a production path.
