/**
 * Secrets are not declared in wrangler.jsonc, so wrangler's generated
 * worker-configuration.d.ts cannot know about them. Declaring them here merges with
 * that generated global `Env`.
 *
 * Locally they come from `.dev.vars` (gitignored). In production they are set with
 * `wrangler secret put <NAME>` and never touch a file.
 */
interface Env {
	/** Unlocks the PWA. Single user, so there is no username anywhere. */
	SUGU_PASSPHRASE: string;
	/** HMAC key that signs session tokens. */
	TOKEN_SECRET: string;
	/** Separate token guarding /api/probe/* and /api/import. */
	ADMIN_TOKEN: string;
	/** Phase 1: model providers. */
	DEEPSEEK_API_KEY: string;
	OPENROUTER_API_KEY: string;
	/** Phase 1: remote MCP servers. */
	SEPIA_TOKEN: string;
	EXA_API_KEY: string;
	/** Phase 2: fine-grained GitHub PAT. */
	GITHUB_TOKEN: string;
}
