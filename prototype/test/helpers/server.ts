import { spawn, type Subprocess } from 'bun';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const HEALTH_PATH = '/api/health';

async function findFreePort(): Promise<number> {
	return new Promise((resolve, reject) => {
		const srv = createServer();
		srv.listen(0, '127.0.0.1', () => {
			const addr = srv.address() as { port: number };
			const port = addr.port;
			srv.close(() => resolve(port));
		});
		srv.on('error', reject);
	});
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
	const port = opts?.port ?? (await findFreePort());
	const baseUrl = `http://127.0.0.1:${port}`;
	const wsBaseUrl = `ws://127.0.0.1:${port}`;

	const persistDir = await mkdtemp(join(tmpdir(), 'sugu-test-'));

	const proc: Subprocess = spawn({
		cmd: ['bunx', 'wrangler', 'dev', '--config', 'wrangler.jsonc', '--port', String(port), '--persist-to', persistDir],
		cwd: '/home/node/Documents/GitHub/sugu/prototype',
		env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
		stdout: 'pipe',
		stderr: 'pipe',
	});

	try {
		await waitForHealth(baseUrl, 20000);
	} catch (e) {
		try {
			proc.kill();
		} catch {}
		await new Promise((r) => setTimeout(r, 500));
		try {
			proc.kill(9);
		} catch {}
		try {
			await rm(persistDir, { recursive: true, force: true });
		} catch {}
		throw e;
	}

	let stopped = false;
	return {
		baseUrl,
		wsBaseUrl,
		stop: async () => {
			if (stopped) return;
			stopped = true;
			try {
				proc.kill();
			} catch {}
			await new Promise((r) => setTimeout(r, 500));
			try {
				proc.kill(9);
			} catch {}
			try {
				await rm(persistDir, { recursive: true, force: true });
			} catch {}
		},
	};
}
