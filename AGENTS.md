# Sugu — agent notes

Phone-first agent sessions on Cloudflare Free. The plan lives in `plan/` and is **not in
git**; the code lives at the repo root.

## Ground rules

- **Bun only.** Never npm/pnpm/yarn in a command, a doc example, or a lockfile.
- **Ask before dev servers, builds and deploys.** `wrangler dev`, `bun run build` and
  `wrangler deploy` are run by Michael unless he says otherwise.
- **`plan/` is local.** Do not link to it from tracked files, and do not wire its paths
  into package descriptions, scripts or READMEs.
- **Valibot, not Zod.** Wire schemas live in `src/shared/contracts.ts` and are shared by
  the Worker and the SPA.
- **Svelte 5 runes only** (`$state`, `$derived`, `$props`, `$effect`); `onclick`, never
  `on:click`.
- **UI**: WCAG AA contrast minimum, no gradients, Tailwind v4 semantic tokens (no
  hardcoded hex/HSL in components), `cn` (clsx + tailwind-merge) for conditional classes.
- **Commits**: Conventional Commits, subject ≤ 50 chars, no AI attribution of any kind.

## Layout

| Path                        | What                                                    |
| --------------------------- | ------------------------------------------------------- |
| `wrangler.jsonc`            | the deploy contract: assets binding + DO classes         |
| `src/worker.ts`             | Worker entry: routing, auth, WS upgrade, assets fallback |
| `src/session-cell.ts`       | `SessionCell` DO — one per conversation, SQLite + WS     |
| `src/meta-cell.ts`          | `MetaCell` DO — the session index                        |
| `src/server/*`              | pure helpers: auth, http, probe                          |
| `src/shared/contracts.ts`   | Valibot wire schemas shared with the SPA                 |
| `sugu/`                     | SvelteKit SPA (`adapter-static` → `sugu/build`)          |
| `scripts/`                  | local Bun scripts (quota probe, opencode import)         |
| `test/`                     | `bun test`; integration tests start their own dev server |

## Files that must not exist

`CLAUDE.md` and `.github/copilot-instructions.md`. `AGENTS.md` is the only
agent-instruction file in this repo.

## Cloudflare Workers

STOP. Your knowledge of Cloudflare Workers APIs and limits may be outdated. Always retrieve
current documentation before any Workers, KV, R2, D1, Durable Objects, Queues, Vectorize, AI
or Agents SDK task.

- Docs: <https://developers.cloudflare.com/workers/>
- Docs MCP: `https://docs.mcp.cloudflare.com/mcp`
- For all limits and quotas, read the product's `/platform/limits/` page, e.g.
  `/workers/platform/limits`.
- Durable Objects: <https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/>

| Command                 | Purpose                  |
| ----------------------- | ------------------------ |
| `bun run dev`           | local dev (`wrangler dev`) |
| `bun run deploy`        | build the SPA, then deploy |
| `bun run cf-typegen`    | `wrangler types`         |

Run `cf-typegen` after changing bindings in `wrangler.jsonc`. Note that a leading `cd` in a
shell command can be dropped by some agent harnesses, so prefer `--cwd` (bun) and `--config`
with an absolute path (wrangler) over relying on the working directory.

**Local Explorer** — while `bun run dev` is running, the base URL printed at startup serves a
Local Explorer API for inspecting bindings and storage: `/cdn-cgi/local/explorer/api/local/workers`,
`.../storage/kv/namespaces`, `.../workers/durable_objects/namespaces`, and
`POST .../local/observability/query` for read-only SQL (`SELECT`/`WITH`) over captured spans and
logs. Fetch `GET /cdn-cgi/local/explorer/api` for the full OpenAPI schema (large; last resort).
