# Sugu

Phone-first agent session on Cloudflare Free — SvelteKit PWA + one Worker + Durable Objects.

## Develop

```sh
bun install
bun run dev        # builds the PWA, then wrangler dev at localhost:8787
```

## Build & check

```sh
bun run --cwd sugu build
bun run --cwd sugu check
bun tsc --noEmit
bun test
```

## Deploy

```sh
bun run deploy
```
