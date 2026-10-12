import { spawn, type Subprocess } from 'bun';

const DEFAULT_PORT = 8787;
const HEALTH_PATH = '/api/health';

function findFreePort(): number {
	// Let OS assign a free port by binding to 0, or use 8787 if free
	return DEFAULT_PORT;
}

async function waitForHealth(base: string, timeoutMs = 15000): Promise<void> {
	const start = Date.now();
	while (Date.now() - start < timeoutMs) {
		try {
			const res = await fetch(`${base}${HEALTH_PATH}`);
			if (res.ok) return;
		} catch {
			// not up yet
		}
		await new Promise((r) => setTimeout(r, 300));
	}
	throw new Error(`dev server not ready at ${base}${HEALTH_PATH} after ${timeoutMs}ms`);
}

export type DevServer = {
	baseUrl: string;
	wsBaseUrl: string;
	stop: () => Promise<void>;
};

export async function startDevServer(opts?: { port?: number }): Promise<DevServer> {
	const port = opts?.port ?? DEFAULT_PORT;
	const baseUrl = `http://127.0.0.1:${port}`;
	const wsBaseUrl = `ws://127.0.0.1:${port}`;

	// If already listening, reuse it
	try {
		const res = await fetch(`${baseUrl}${HEALTH_PATH}`, { signal: AbortSignal.timeout(1000) });
		if (res.ok) {
			return { baseUrl, wsBaseUrl, stop: async () => {} };
		}
	} catch {
		// not listening — start one
	}

	const proc: Subprocess = spawn({
		cmd: ['bunx', 'wrangler', 'dev', '--config', 'wrangler.jsonc', '--port', String(port)],
		cwd: '/home/node/Documents/GitHub/sugu/prototype',
		env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
		stdout: 'pipe',
		stderr: 'pipe',
	});

	// Wait for health
	try {
		await waitForHealth(baseUrl, 20000);
	} catch (e) {
		try {
			proc.kill();
		} catch {}
		throw e;
	}

	return {
		baseUrl,
		wsBaseUrl,
		stop: async () => {
			try {
				proc.kill();
			} catch {}
			// Give it a moment to exit
			await new Promise((r) => setTimeout(r, 500));
			try {
				proc.kill(9);
			} catch {}
		},
	};
}
