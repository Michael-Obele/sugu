export {};
// Local quota-probe driver — walks CPU and rows-written limits against /api/probe/*
// Usage: bun --cwd /home/node/Documents/GitHub/sugu/prototype run scripts/quota-probe.ts [--target <url>] [--admin-token <t>] [--max <n>] [--dry-run]
// Never deploy, never run against anything but the URL you were given.
// Local workerd limits are NOT production limits — do not record local numbers as free-tier facts.

const args = process.argv.slice(2);

function getFlag(name: string, fallback?: string): string | undefined {
	const idx = args.indexOf(`--${name}`);
	if (idx !== -1 && args[idx + 1] && !args[idx + 1]!.startsWith('--')) return args[idx + 1];
	return fallback;
}

const target = getFlag('target', 'http://localhost:8787')!;
const adminToken = getFlag('admin-token', process.env.ADMIN_TOKEN)!;
const max = parseInt(getFlag('max', '10000000')!, 10);
const dryRun = args.includes('--dry-run');

if (!adminToken && !dryRun) {
	console.error('Missing --admin-token and no ADMIN_TOKEN env var. Use --dry-run to preview without sending.');
	process.exit(1);
}

type ProbeResult = { label: string; ok: boolean; detail: string };

async function probeCompute(): Promise<ProbeResult[]> {
	const results: ProbeResult[] = [];
	const steps = [1000, 10_000, 100_000, 1_000_000, 5_000_000, 10_000_000].filter((n) => n <= max);
	for (const iterations of steps) {
		if (dryRun) {
			results.push({ label: `compute ${iterations}`, ok: true, detail: 'dry-run: would POST /api/probe/compute' });
			continue;
		}
		try {
			const res = await fetch(`${target}/api/probe/compute`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', Authorization: `Bearer ${adminToken}` },
				body: JSON.stringify({ iterations }),
			});
			const body = await res.text();
			if (res.ok) {
				const data = JSON.parse(body) as { iterations: number; elapsedMs: number };
				results.push({ label: `compute ${iterations}`, ok: true, detail: `${data.elapsedMs}ms` });
			} else {
				results.push({ label: `compute ${iterations}`, ok: false, detail: `${res.status} ${body.slice(0, 200)}` });
				break;
			}
		} catch (e) {
			results.push({ label: `compute ${iterations}`, ok: false, detail: String(e).slice(0, 200) });
			break;
		}
	}
	return results;
}

async function probeRows(): Promise<ProbeResult[]> {
	const results: ProbeResult[] = [];
	const steps = [10, 100, 1000, 5000].filter((n) => n <= max);
	for (const count of steps) {
		if (dryRun) {
			results.push({ label: `rows ${count}`, ok: true, detail: 'dry-run: would POST /api/probe/rows' });
			continue;
		}
		try {
			const res = await fetch(`${target}/api/probe/rows`, {
				method: 'POST',
				headers: { 'content-type': 'application/json', Authorization: `Bearer ${adminToken}` },
				body: JSON.stringify({ count }),
			});
			const body = await res.text();
			if (res.ok) {
				const data = JSON.parse(body) as { written: number };
				results.push({ label: `rows ${count}`, ok: true, detail: `written=${data.written}` });
			} else {
				results.push({ label: `rows ${count}`, ok: false, detail: `${res.status} ${body.slice(0, 200)}` });
				break;
			}
		} catch (e) {
			results.push({ label: `rows ${count}`, ok: false, detail: String(e).slice(0, 200) });
			break;
		}
	}
	return results;
}

async function main() {
	console.log(`# Quota probe — target=${target} max=${max} dryRun=${dryRun}`);
	console.log('');
	console.log('> Local workerd limits are NOT production limits — do not record local numbers as free-tier facts.');
	console.log('> A production run happens after the human deploys.');
	console.log('');

	if (dryRun) {
		console.log('## Plan (dry-run)');
		console.log('- POST /api/probe/compute with iterations: 1k, 10k, 100k, 1M, 5M, 10M (up to --max)');
		console.log('- POST /api/probe/rows with count: 10, 100, 1000, 5000 (up to --max)');
		console.log('- Request-rate walk: sequential GET /api/health bursts (not yet implemented)');
		console.log('');
	}

	const compute = await probeCompute();
	const rows = await probeRows();

	function printTable(title: string, rows2: ProbeResult[]) {
		console.log(`## ${title}`);
		console.log('| probe | status | detail |');
		console.log('|---|---|---|');
		for (const r of rows2) {
			console.log(`| ${r.label} | ${r.ok ? 'ok' : 'fail'} | ${r.detail} |`);
		}
		console.log('');
	}

	printTable('CPU walk', compute);
	printTable('Rows-written walk', rows);

	console.log('_Probe complete. Paste the tables into plan/research.md. Local numbers are workerd, not production._');
}

await main();
