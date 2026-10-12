import { spawn, type Subprocess } from 'bun';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:net';

const HEALTH_PATH = '/api/health';

// Resolve the project from this file rather than from the working directory or a
// hardcoded path, so the suite runs anywhere (a moved checkout, CI).
const PROJECT_ROOT = join(import.meta.dir, '..', '..');

// Spawn wrangler through its own bin shim, which runs it under node via its shebang.
// Do NOT run `wrangler.js` through bun (`process.execPath`): when bun is the runtime,
// `wrangler dev` takes its AI-agent path, prints "Ready on …" and then never answers a
// request, so the health check hangs forever.
const WRANGLER_BIN = join(PROJECT_ROOT, 'node_modules', '.bin', 'wrangler');

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
			// A wedged dev server accepts the connection and then never answers, so this
			// request needs its own timeout — without one, the poll loop below blocks
			// forever instead of reporting the failure.
			const res = await fetch(`${base}${HEALTH_PATH}`, { signal: AbortSignal.timeout(2000) });
			if (res.ok) return;
		} catch {
			// not up yet
		}
		await new Promise((r) => setTimeout(r, 300));
	}
	throw new Error(`dev server not ready at ${base}${HEALTH_PATH} after ${timeoutMs}ms`);
}

async function killProcess(proc: Subprocess): Promise<void> {
	try {
		proc.kill();
	} catch {}
	await new Promise((r) => setTimeout(r, 300));
	try {
		proc.kill(9);
	} catch {}
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

	// The child's output goes to a file rather than a pipe. Nothing here reads a pipe, so
	// a full pipe buffer would block wrangler part-way through starting; the file also
	// gives the timeout below something real to report.
	const logPath = join(persistDir, 'wrangler.log');

	// `wrangler dev` changes behaviour when it thinks an AI agent spawned it: it prints a
	// Local Explorer banner instead of serving normally, so `/api/health` never answers.
	// Strip the markers — this suite is usually run by an agent, and the child must be an
	// ordinary dev session either way.
	const env: Record<string, string | undefined> = {
		...process.env,
		WRANGLER_SEND_METRICS: 'false'
	};
	for (const marker of ['AI_AGENT', 'COPILOT_AGENT', 'CLAUDECODE', 'CURSOR_TRACE_ID']) {
		delete env[marker];
	}

	const proc: Subprocess = spawn({
		cmd: [
			WRANGLER_BIN,
			'dev',
			'--config',
			join(PROJECT_ROOT, 'wrangler.jsonc'),
			'--port',
			String(port),
			'--persist-to',
			persistDir
		],
		cwd: PROJECT_ROOT,
		env,
		stdout: Bun.file(logPath),
		stderr: Bun.file(logPath)
	});

	try {
		// Must stay below the hooks' budget in the test files, otherwise the hook times out
		// first and this error (which carries the child's log) never gets a chance to print.
		await waitForHealth(baseUrl, 15_000);
	} catch (e) {
		await killProcess(proc);
		const log = await Bun.file(logPath)
			.text()
			.catch(() => '(could not read the log)');
		await rm(persistDir, { recursive: true, force: true }).catch(() => {});
		throw new Error(`${(e as Error).message}\n--- wrangler output ---\n${log.slice(-4000)}`);
	}

	let stopped = false;
	return {
		baseUrl,
		wsBaseUrl,
		stop: async () => {
			if (stopped) return;
			stopped = true;
			await killProcess(proc);
			await rm(persistDir, { recursive: true, force: true }).catch(() => {});
		},
	};
}
