# Sugu — agent notes

Phone-first agent sessions on Cloudflare Free. The plan lives in `plan/` and is **not in
git**; the code lives in `prototype/`.

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

| Path                              | What                                                     |
| --------------------------------- | -------------------------------------------------------- |
| `prototype/wrangler.jsonc`        | the deploy contract: assets binding + DO classes          |
| `prototype/src/worker.ts`         | Worker entry: routing, auth, WS upgrade, assets fallback  |
| `prototype/src/session-cell.ts`   | `SessionCell` DO — one per conversation, SQLite + WS      |
| `prototype/src/meta-cell.ts`      | `MetaCell` DO — the session index                         |
| `prototype/src/server/*`          | pure helpers: auth, models, mcp, github, skills           |
| `prototype/src/shared/contracts.ts` | Valibot wire schemas shared with the SPA                |
| `prototype/sugu/`                 | SvelteKit SPA (`adapter-static` → `sugu/build`)           |
| `prototype/scripts/`              | local Bun scripts (quota probe, opencode import)          |

## Files that must not exist

`CLAUDE.md` and `.github/copilot-instructions.md`. `AGENTS.md` is the only
agent-instruction file in this repo.
