import { defineConfig } from 'vite-plus';

export default defineConfig({
	fmt: {
		// House style from .prettierrc + sugu/prettier.config.js:
		// tabs, single quotes, semi, trailingComma none.
		// Root (Worker) uses printWidth 140, SPA in sugu/ uses 100 — scoped via overrides
		// to avoid silently changing either. Prettier parity: root 140, sugu 100.
		ignorePatterns: ['worker-configuration.d.ts'],
		useTabs: true,
		singleQuote: true,
		semi: true,
		trailingComma: 'none',
		printWidth: 140,
		// Oxfmt supports .svelte via Prettier-backed path; requires `svelte` package
		// (present in sugu workspace). Enabled explicitly per Oxfmt docs.
		svelte: true,
		overrides: [
			{
				files: ['sugu/**'],
				options: { printWidth: 100 }
			}
		]
	},
	lint: {
		// Oxlint's Svelte support is NOT confirmed — Svelte absent from Oxc
		// compatibility page (risk: false positives / syntax misinterpretation).
		// Exclude .svelte from lint; svelte-check remains the .svelte type gate
		// (tsgo does not type-check .svelte and does not know Cloudflare generated types).
		// Do not exclude files just to make the gate go green — this exclusion is
		// documented and intentional.
		ignorePatterns: ['**/*.svelte', 'sugu/build/**', '.svelte-kit/**', 'sugu/.svelte-kit/**']
	}
});
