# Task 3 — PWA phone chat shell — report

## What was implemented

**Scaffold**
- Added `svelte.config` alias for `$lib` (SvelteKit 3 deprecates `config.alias` but build still works; `tsconfig.json` now has explicit `paths` for `$lib`).
- Ran `shadcn-svelte` CLI via `bunx shadcn-svelte@latest add button input` (with manual `components.json` and `src/lib/utils.ts` for `cn`).
- Icons via `@lucide/svelte` (not used directly yet, but available).

**Design tokens**
- `src/routes/layout.css` — dark OLED theme: near-black surfaces (`oklch(0.14 0 0)`), semantic tokens (`--color-background`, `--color-primary`, etc.), `prefers-reduced-motion` disables animations, `color-scheme: dark`.

**Protocol client (pure, unit-tested)**
- `src/lib/backoff.ts` — `backoffDelay(attempt)` and `Backoff` class: 1 → 2 → 4 → 8 s, capped at 8 s, `reset()` on successful connect.
- `src/lib/frames.ts` — `applyFrame(state, frame)` reducer: tokens append to bubble keyed by `seq`, persisted `msg` replaces live text (last persisted wins), replay for same `seq` replaces (no duplicate), out-of-order frames placed by `seq` (sorted), unknown frames via `applyRawFrame` ignored with `ignoredCount++`.
- `src/lib/api.ts` — REST client: `login`, `listSessions`, `createSession`, bearer token in `localStorage`, `401` clears token and calls `onUnauthorized` for redirect.
- `src/lib/socket.ts` — `SuguSocket`: connects with `?sessionId=&token=`, sends `hello { sessionId, token, since }`, decodes with Valibot `parseFrame`, ignores unknown frames, tracks `since` for resume, reconnects with 1→2→4→8 s backoff and re-hellos with `since`.
- `src/lib/session.svelte.ts` — rune store: `token`, `sessionId`, `frameState`, `connection`, `busy`, `messages`, `tools`; `connect`, `disconnect`, `send`, `cancel`, `reset`.

**Components**
- `ConnectionBanner` — shows "Connecting…" / "Reconnecting…" when `state` is `connecting`/`reconnecting`, `aria-live="polite"`.
- `MessageBubble` — user (primary) vs assistant (card), `streaming` with `aria-live="polite"` throttled to ~1 s, `interrupted` with dashed amber border and "Re-run" button (44 px tap target).
- `ToolRow` — collapsed inline `ran \`name\` ✓`, amber and expandable when `failed`.
- `MessageList` — keyed `{#each messages as msg (msg.seq)}`, tools grouped by `seq`, empty state.
- `Composer` — fixed bottom, textarea + Send/Stop, disabled while `busy`, 44 px targets, `Enter` to send, `Shift+Enter` for newline.
- `SessionList` — newest first (sorted by `updatedAt`), "New session" button, tap to open.

**Screens**
- `/login` — passphrase field, "Wrong passphrase" on 401, "Too many attempts, wait a few minutes" on 429, redirects to `?redirect=` or `/`.
- `/` — session list, "new session" creates and navigates to `/s/[id]`, Settings link.
- `/s/[id]` — chat: `ConnectionBanner` top, header with back + session id + connection dot, scrollable `MessageList`, `Composer` fixed bottom with safe-area insets. Offline: keeps text in composer, sends on reconnect. Resume: `hello { since: lastSeq }` on reconnect, server replays.
- `/settings` — model default (text input, saved to `localStorage`), quota placeholder (dashed border), logout (clears token, goes to `/login`).

**PWA**
- `static/manifest.webmanifest` — name "Sugu", short_name "Sugu", `display: standalone`, `theme_color`/`background_color` `#232323`, icons: favicon.svg + 192 + 512 PNGs (dark `#232323` placeholders via ImageMagick).
- `src/routes/+layout.svelte` — `theme-color` meta, `apple-mobile-web-app-*` tags, `manifest` link, `apple-touch-icon`.
- No service worker — skipped intentionally (see below).

## Exact commands with real output

```bash
bun --cwd /home/node/Documents/GitHub/sugu/prototype/sugu run check
# svelte-check found 0 errors and 0 warnings

bun --cwd /home/node/Documents/GitHub/sugu/prototype run build
# ✓ built in 556ms (client) + 952ms (server)
# Wrote site to "build"
# sugu/build/index.html exists

bun --cwd /home/node/Documents/GitHub/sugu/prototype test
# 66 pass, 0 fail, 168 expect() calls, 6 files, ~8s
```

## Only frames this client sends

The only frames this client sends are `hello`, `send`, `cancel` and `ack`.

- `hello { sessionId, token, since }` on connect and on every reconnect (resume).
- `send { text }` from the composer.
- `cancel` when the user taps Stop while `busy`.
- `ack { seq, to }` (wired in `SuguSocket.ack`, not yet used in Phase 0 but available for future flow control).
- No keepalive, no heartbeat — the platform handles WebSocket ping/pong at the edge without waking the Durable Object.

## What was skipped and why

**Service worker — skipped.** The chat needs the network anyway (WebSocket to the Durable Object), and an offline shell is polish that belongs with the later history work (Phase 2). Adding it now would cache a shell that can't do anything useful offline and would complicate the "resume via `hello { since }`" path. The brief explicitly says to skip it.

## Concerns

- `vite.config.ts` uses `sveltekit({ alias: { $lib: ... } })` which is deprecated in SvelteKit 3 (`config_option_deprecated_alias` warning). The proper fix is subpath imports (`#lib`), but the project currently uses `$lib` everywhere (including shadcn components). Migrating to `#lib` is a follow-up; build and check still pass with the warning.
- `MessageBubble` uses `$effect` for throttling `aria-live` announcements — this is an external side effect (screen reader), not state sync, so it's allowed per the brief's "genuinely external side effects" rule.
- PWA icons are solid dark placeholders (`#232323`); a designer should replace them with proper Sugu branding before store submission.
- `session.svelte.ts` uses `$effect` for pending-send-on-reconnect — this is borderline state sync; it could be moved to an explicit function called from the `onState` callback instead. Left as is for now since it's a one-line reconnect side effect.

## Verification

- `svelte-check` clean (0 errors, 0 warnings).
- `vite build` succeeds, `sugu/build/index.html` written.
- `bun test` — 66 tests pass (51 existing + 15 new: 5 backoff + 10 frames).
- Manual smoke: `wrangler dev --port 8787` serves the SPA, login with `dev-passphrase`, create session, send message, see echo stream, kill socket and see reconnect banner.

---

## Fix batch — review findings (2026-10-12)

All 7 findings fixed in one batch. No Critical issues; hard parts (no keepalive, resume by `hello{since}`, token-then-`msg` rule, PWA manifest, `svelte-check` 0/0) left untouched.

### 1. Backoff duplicated instead of reused (Important)

**Finding:** `sugu/src/lib/socket.ts` re-implemented doubling with `backoffMs` instead of using `sugu/src/lib/backoff.ts`.

**Fix:** `socket.ts` now `import { Backoff } from './backoff'`, holds `private backoff = new Backoff()`, calls `this.backoff.reset()` on `open` and `this.backoff.next()` in `scheduleReconnect()`. Local arithmetic deleted.

### 2. Three `$effect`s used for state synchronisation (Important)

**Finding:** `sugu/src/routes/s/[id]/+page.svelte:28-38` synced route param into `sessionStore.connect()` via `$effect`; `:58-66` synced `connection` + `pendingSend` into `send()` via `$effect`.

**Fix:** Both `$effect`s removed. `doConnect(id)` is a plain function with a `lastConnectedId` guard against double-connect on rapid navigation. It is called from `onMount` and from `afterNavigate` (SvelteKit navigation hook). Pending-send flush is now via an `onOpen` callback passed to `sessionStore.connect(id, flushPending)`, which the store invokes from its `onState` handler when `state === 'open'`. No `$effect` remains in the page; the only `$effect` in the app is the external side-effect in `MessageBubble` (screen-reader throttle), which is the correct use.

`session.svelte.ts` updated: `connect(sessionId, onOpen?)` now forwards `onOpen` to the `onState` callback.

### 3. Interactive element misses 44px tap target (Important)

**Finding:** `ToolRow.svelte:18-32` button had `py-2` (~32px).

**Fix:** Added `min-h-[44px] min-w-[44px]` to the button's class list, matching every other interactive element.

### 4. `aria-live` throttle drops text with no trailing flush (Important)

**Finding:** `MessageBubble.svelte:15-27` throttled to ~1s but discarded deltas and only flushed when `streaming` became `false`.

**Fix:** Added `pendingAnnounce` + `announceTimer` with `flushAnnounce()` and `scheduleAnnounce(next)`. Leading edge announces immediately if ≥1s since last; otherwise the latest text is saved as `pendingAnnounce` and a `setTimeout` flushes it on the trailing edge. When `streaming` becomes `false`, `flushAnnounce()` is called so the final content is always announced.

### 5. `localStorage` read at module load (Important)

**Finding:** `sugu/src/lib/api.ts:26-48` and `session.svelte.ts:22` read `localStorage` at construction time; `try/catch` hid the failure.

**Fix:** `api.ts` now has `hasLocalStorage()` (`typeof localStorage !== 'undefined'`) and both `setToken`/`getToken` return early when unavailable — intent is explicit, not accidentally safe. `session.svelte.ts` constructor guards with `if (typeof localStorage !== 'undefined')` before calling `getToken()`.

### 6. Unknown-frame handling untested at the real boundary (Important)

**Finding:** `frames.ts:124-150` `applyRawFrame` was test-only; real path is `JSON.parse` → `parseFrame` → `applyFrame` (and socket's error path). `applyFrame`'s default branch silently swallowed unknown `t` with no counter.

**Fix:** `applyFrame`'s `default` branch now increments `ignoredCount`. `applyRawFrame` deleted. Test `test/frames.test.ts` rewritten to exercise the real boundary: `JSON.parse` → `parseFrame` (asserts `ok === false` for unknown `t` and bad version, and that state is unchanged on the socket error path), plus direct `applyFrame` with `as unknown as Frame` to assert the default branch increments `ignoredCount` and never throws nor mutates messages.

### 7. Warning colour is not a semantic token (Rule violation)

**Finding:** `MessageBubble.svelte:37,53` and `ToolRow.svelte:22-26,42` used `amber-500` directly.

**Fix:** Added `--color-warning: oklch(0.77 0.16 70)` and `--color-warning-foreground: oklch(0.97 0.02 70)` to `sugu/src/routes/layout.css` `@theme`. All `amber-*` classes replaced with `border-warning`, `bg-warning`, `text-warning`, `text-warning-foreground`, `ring-warning`.

### Not changed

- No service worker added (brief explicitly skips it).
- `test/helpers/server.ts` untouched (wrangler must run via its bin shim under node).
- `$lib`/`#lib` alias, shadcn provenance, relative contracts import left as deferred.

### Verify and report — real output

```bash
bun tsc --noEmit
# (no output, exit 0)

bun test
# 66 pass, 0 fail, 175 expect() calls, 6 files — both consecutive runs
# Run 1: 66 pass, 0 fail, 175 expect() calls [10.64s]
# Run 2: 66 pass, 0 fail, 175 expect() calls [10.48s] (second run [10.03s] after formatting)

bun run --cwd sugu check
# svelte-check found 0 errors and 0 warnings

bun run --cwd sugu build
# ✓ built in 1.59s (SSR) + 872ms (client)
# Wrote site to "build"
# sugu/build/index.html exists (1.4K)
```

Do not deploy — not deployed.


---

## Fix — live user message not displayed (2026-10-12)

### Bug

Send a message: composer cleared, assistant echo streamed, but the user's own message never appeared until reload. Reload triggered `hello{since}` replay and the replayed `user` event came back as `msg { role: 'user' }`, so persisted row and replay were correct — only the live turn was missing the frame.

Cause: `src/session-cell.ts:handleSend` inserted the `user` event row but never sent a `msg { role: 'user' }` frame during the live turn. Only `role: 'assistant'` frames were sent live. `eventRowToFrame` produced the user msg only on replay, so the same event had two divergent paths.

### Fix

In `handleSend`, immediately after the `INSERT` for the `user` row, capture `last_insert_rowid()` and emit the same `msg` frame replay would produce via the existing `eventRowToFrame` mapping — same `seq`, same `id`, same `text`, `role: 'user'`.

- No extra row writes: `SELECT last_insert_rowid()` is a read, not a write. Budget stays at 3 writes/turn (user insert + assistant reserve + assistant update, limit 8).
- `seq` equals the persisted row id (cell-monotonic ordering key the client sorts by).
- Outbound frame only — does not wake anything or cost an extra request.
- One event, one shape, both paths (`eventRowToFrame` is the single source of truth).

Diff (`src/session-cell.ts`):

```ts
// Persist user message
this.ctx.storage.sql.exec(
	'INSERT INTO events (ts, type, role, payload, meta) VALUES (?, ?, ?, ?, ?)',
	ts, 'user', 'user', JSON.stringify({ text: frame.text }), null,
);
// Emit the same msg frame replay would produce -- one event, one shape, both paths.
{
	const userRowId = (this.ctx.storage.sql.exec('SELECT last_insert_rowid() as id').one() as unknown as { id: number }).id;
	const userFrame = eventRowToFrame({
		id: userRowId, type: 'user', role: 'user',
		payload: JSON.stringify({ text: frame.text }), meta: null,
	});
	if (userFrame) ws.send(JSON.stringify(userFrame));
}
```

### Test

Added `test/session-cell.test.ts: live send emits msg with role user before replay` — connects, sends `hello-live`, asserts live frames include `msg { role: 'user', text: 'hello-live', seq === id }`, verifies `seq` equals the persisted user row id via `?__snapshot=1`, asserts still only 2 rows (no extra writes), and asserts `user seq < assistant seq` ordering.

Previous suite only checked replayed user events, which is why this slipped through.

### Verify — real output

```bash
bun tsc --noEmit
# (no output, exit 0)

bun test
# Run 1: 67 pass, 0 fail, 185 expect() calls, 6 files [7.84s]
# Run 2: 67 pass, 0 fail, 185 expect() calls, 6 files [7.54s]

bunx prettier --write src/session-cell.ts test/session-cell.test.ts
# src/session-cell.ts 328ms (unchanged)
# test/session-cell.test.ts 126ms
```

Not changed: `test/helpers/server.ts` (wrangler bin shim under node is load-bearing). Not deployed.

### Concerns

- None for this fix. The `SELECT last_insert_rowid()` read is safe here because it runs synchronously on the same DO storage connection immediately after the user `INSERT` and before the assistant reserve `INSERT`, so it returns the user row id.
---

## Fix — composer stuck busy after turn (2026-10-12)

### Bug

Send one message, let the turn finish, and the composer stays disabled forever ("Waiting for response…" with Stop). Only a reload recovers because reload's `hello` gets a fresh `state` frame. Cause: in `src/session-cell.ts` both turn-ending paths sent the state frame before clearing the busy flag, so the frame carried `busy: true`:

```ts
ws.send(JSON.stringify(this.buildStateFrame())); // reads this.busy, still true
this.busy = false;                               // cleared too late
```

`buildStateFrame()` reads `this.busy` and the client disables its composer from that frame — so the last word the client hears about busy is `true`. Two places had the same ordering bug: the normal completion path (after the final assistant `msg`) and the `if (signal.aborted)` cancel path.

### Fix

Clear the flag before the frame is built and sent, in both paths. Turn state (`pendingSeq`, `pendingText`, `pendingAssistantId`, `abortCtrl`) is cleared with it. Order now reads: finish the row → send the final `msg` → clear busy and turn state → send the state frame. Nothing observes a half-finished turn.

Diff (`src/session-cell.ts`):

```ts
// cancel path — before:
ws.send(JSON.stringify({ v: 1, t: 'msg', ...interrupted: true }));
ws.send(JSON.stringify(this.buildStateFrame()));
this.busy = false; this.pendingSeq = null; ...
// after:
ws.send(JSON.stringify({ v: 1, t: 'msg', ...interrupted: true }));
this.busy = false; this.pendingSeq = null; ... this.abortCtrl = null;
ws.send(JSON.stringify(this.buildStateFrame()));

// normal path — before:
ws.send(JSON.stringify({ v: 1, t: 'msg', ...text: echoText }));
ws.send(JSON.stringify(this.buildStateFrame()));
this.busy = false; ...
// after:
ws.send(JSON.stringify({ v: 1, t: 'msg', ...text: echoText }));
this.busy = false; ... this.abortCtrl = null;
ws.send(JSON.stringify(this.buildStateFrame()));
```

Not changed: row reservation logic, `setTimeout` yield, streams — deliberate and separately justified in surrounding comments.

### Tests — why the suite missed it

`test/session-cell.test.ts` asserted the busy *rejection* path (second `send` while busy errors) and `test/frames.test.ts` asserted the *reducer* handles `busy`. Nothing asserted that a completed turn ever says `busy: false` again, so the two halves were both tested and the join was not.

Added in `test/session-cell.test.ts`:

- `completed turn ends with state { busy: false }` — asserts on the last state frame received, not merely that some state arrived.
- `cancelled turn ends with state { busy: false }` — same for the cancel path.
- `after turn completes second send is accepted` — user-facing: after a turn completes, a second `send` is accepted and produces its own output rather than `err { code: 'busy' }`.

### Verify — real output

```bash
bun tsc --noEmit
# (no output, exit 0)

bun test
# Run 1: 70 pass, 0 fail, 191 expect() calls, 6 files [8.71s]
# Run 2: 70 pass, 0 fail, 191 expect() calls, 6 files [9.06s]

bunx prettier --write src/session-cell.ts test/session-cell.test.ts
# src/session-cell.ts 206ms (unchanged)
# test/session-cell.test.ts 156ms (unchanged)
```

Not changed: `test/helpers/server.ts` (wrangler bin shim under node is load-bearing). Not deployed.

### Concerns

- None for this fix. The ordering change is the minimal correct fix and both paths now follow the same clear-then-frame sequence.

