import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { oneOrNull } from '../src/shared/sql';
import { resolveSkillsForTurn } from '../src/server/skills';
import { signToken } from '../src/server/auth';
import { startDevServer, TEST_SECRETS, type DevServer } from './helpers/server';

// ---------------------------------------------------------------------------
// Helpers: cursors that mimic workerd SQLite behaviour
// ---------------------------------------------------------------------------
function throwingCursor<TRow>(rows: TRow[]): Iterable<TRow> & { one: () => TRow; toArray: () => TRow[] } {
	return {
		one() {
			if (rows.length === 0) throw new Error('Expected exactly one result from SQL query, but got no results.');
			if (rows.length > 1) throw new Error('Expected exactly one result from SQL query, but got more than one.');
			return rows[0]!;
		},
		toArray() {
			return [...rows];
		},
		[Symbol.iterator]() {
			return rows[Symbol.iterator]();
		}
	};
}

function iterableCursor<TRow>(rows: TRow[]): Iterable<TRow> & { toArray?: () => TRow[] } {
	return {
		toArray() {
			return [...rows];
		},
		[Symbol.iterator]() {
			return rows[Symbol.iterator]();
		}
	};
}

function noToArrayCursor<TRow>(rows: TRow[]): Iterable<TRow> {
	return {
		[Symbol.iterator]() {
			return rows[Symbol.iterator]();
		}
	} as Iterable<TRow>;
}

// SQL stub that throws on .one() when cache miss (real workerd behaviour)
function makeThrowingSqlStub(rows: Map<string, { content: string; source: string; path: string }>) {
	return {
		exec(query: string, ...params: unknown[]) {
			if (query.includes('SELECT') && query.includes('skills_cache')) {
				const name = params[0] as string;
				const row = rows.get(name);
				const backing = row ? [row] : [];
				return {
					one() {
						if (backing.length === 0) throw new Error('Expected exactly one result from SQL query, but got no results.');
						return backing[0]!;
					},
					toArray() {
						return [...backing];
					},
					[Symbol.iterator]() {
						return backing[Symbol.iterator]();
					}
				};
			}
			if (query.includes('INSERT INTO skills_cache')) {
				const [name, source, path, content] = params as string[];
				rows.set(name, { content, source, path });
				return {
					one() {
						return undefined as unknown as never;
					},
					toArray() {
						return [];
					},
					[Symbol.iterator]() {
						return [][Symbol.iterator]();
					}
				};
			}
			return {
				one() {
					throw new Error('unexpected query');
				},
				toArray() {
					return [];
				},
				[Symbol.iterator]() {
					return [][Symbol.iterator]();
				}
			};
		}
	} as unknown as {
		exec: (
			q: string,
			...p: unknown[]
		) => { one: () => unknown; toArray: () => unknown[]; [Symbol.iterator]: () => Iterator<unknown> } & Iterable<unknown>;
	};
}

function makeSkillFetch(contentMap: Record<string, string>): typeof fetch {
	return (async (url: string | URL | Request) => {
		const urlStr = String(url);
		if (urlStr.includes('/contents/') && urlStr.includes('SKILL.md')) {
			for (const [name, content] of Object.entries(contentMap)) {
				if (urlStr.includes(`/${name}/SKILL.md`)) {
					const b64 = Buffer.from(content).toString('base64');
					return new Response(JSON.stringify({ content: b64, encoding: 'base64' }), {
						status: 200,
						headers: { 'content-type': 'application/json' }
					});
				}
			}
			return new Response('not found', { status: 404 });
		}
		if (urlStr.includes('/contents/')) {
			return new Response(JSON.stringify([]), { status: 200, headers: { 'content-type': 'application/json' } });
		}
		return new Response('not found', { status: 404 });
	}) as unknown as typeof fetch;
}

// ---------------------------------------------------------------------------
// Unit: oneOrNull helper
// ---------------------------------------------------------------------------
describe('batch3i: oneOrNull helper', () => {
	test('empty cursor returns null (would have thrown with .one())', () => {
		const c = throwingCursor<Record<string, unknown>>([]);
		expect(oneOrNull(c)).toBeNull();
		// prove .one() would throw
		expect(() => c.one()).toThrow('Expected exactly one result');
	});

	test('single row returns that row', () => {
		const c = throwingCursor([{ id: 'a' }]);
		expect(oneOrNull(c)).toEqual({ id: 'a' });
	});

	test('multiple rows returns first without throwing', () => {
		const c = throwingCursor([{ id: 'a' }, { id: 'b' }]);
		expect(oneOrNull(c)).toEqual({ id: 'a' });
		// .one() would throw on >1
		expect(() => c.one()).toThrow();
	});

	test('works with toArray cursor', () => {
		expect(oneOrNull(iterableCursor([{ x: 1 }]))).toEqual({ x: 1 });
		expect(oneOrNull(iterableCursor([]))).toBeNull();
	});

	test('falls back to iteration when toArray absent', () => {
		expect(oneOrNull(noToArrayCursor([{ x: 1 }]))).toEqual({ x: 1 });
		expect(oneOrNull(noToArrayCursor([]))).toBeNull();
	});

	test('null-safe: handles cursor with toArray returning empty', () => {
		const c: Iterable<number> & { toArray: () => number[] } = {
			toArray: () => [],
			[Symbol.iterator]() {
				return [][Symbol.iterator]();
			}
		};
		expect(oneOrNull(c)).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Unit: skills cache miss does not throw (regression for skills_cache site)
// ---------------------------------------------------------------------------
describe('batch3i: skills cache miss', () => {
	test('cache miss does not throw and falls through to fetch (would throw with .one())', async () => {
		const rows = new Map<string, { content: string; source: string; path: string }>();
		const sql = makeThrowingSqlStub(rows);
		const sources = [{ repo: 'owner/repo', ref: 'main', path: 'skills' }];
		const fetchImpl = makeSkillFetch({ 'my-skill': 'hello skill' });
		// This would throw if resolveSkillsForTurn used .one() without oneOrNull/try-catch
		const result = await resolveSkillsForTurn(['my-skill'], sql as any, sources, fetchImpl);
		expect(result.injection).toContain('hello skill');
		expect(result.subrequests).toBe(1);
	});

	test('cache hit returns cached content without fetch', async () => {
		const rows = new Map<string, { content: string; source: string; path: string }>([
			['cached-skill', { content: 'cached content', source: 'owner/repo@main', path: 'skills/cached-skill/SKILL.md' }]
		]);
		const sql = makeThrowingSqlStub(rows);
		let fetchCalls = 0;
		const countingFetch = (async () => {
			fetchCalls++;
			return new Response('{}', { status: 200 });
		}) as unknown as typeof fetch;
		const sources = [{ repo: 'owner/repo', ref: 'main', path: 'skills' }];
		const result = await resolveSkillsForTurn(['cached-skill'], sql as any, sources, countingFetch);
		expect(fetchCalls).toBe(0);
		expect(result.injection).toContain('cached content');
	});
});

// ---------------------------------------------------------------------------
// Integration: fresh DO / fresh day does not throw
// ---------------------------------------------------------------------------
describe('batch3i: fresh DO regression (integration)', () => {
	let server: DevServer;
	let BASE: string;
	const SECRET = TEST_SECRETS.TOKEN_SECRET;

	beforeAll(async () => {
		server = await startDevServer();
		BASE = server.baseUrl;
	}, 30_000);

	afterAll(async () => {
		await server.stop();
	}, 30_000);

	test('GET /api/quota on fresh day returns 200 with null-safe usage (day one)', async () => {
		const token = await signToken(SECRET);
		const res = await fetch(`${BASE}/api/quota`, { headers: { Authorization: `Bearer ${token}` } });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { day: string; turns: number; prompt_t: number; compl_t: number; cost_usd: number };
		expect(typeof body.day).toBe('string');
		expect(typeof body.turns).toBe('number');
		// Fresh day should be 0 turns, not a 500 from .one() throw
		expect(body.turns).toBeGreaterThanOrEqual(0);
	});

	test('GET /api/skills on fresh session returns 200 (cache miss does not throw)', async () => {
		const token = await signToken(SECRET);
		const res = await fetch(`${BASE}/api/skills`, { headers: { Authorization: `Bearer ${token}` } });
		expect(res.status).toBe(200);
		const body = (await res.json()) as { skills: unknown[]; configured: boolean };
		expect(Array.isArray(body.skills)).toBe(true);
	});

	test('unknown session id does not throw (404 not 500)', async () => {
		const token = await signToken(SECRET);
		const unknownId = `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const res = await fetch(`${BASE}/api/sessions/${encodeURIComponent(unknownId)}/events`, {
			headers: { Authorization: `Bearer ${token}` }
		});
		// Should be 404 (MetaCell.get returns null), not 500 from .one() throw
		expect(res.status).toBe(404);
	});

	test('PATCH unknown session returns 404 not 500', async () => {
		const token = await signToken(SECRET);
		const unknownId = `unknown-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
		const res = await fetch(`${BASE}/api/sessions/${encodeURIComponent(unknownId)}`, {
			method: 'PATCH',
			headers: { 'content-type': 'application/json', Authorization: `Bearer ${token}` },
			body: JSON.stringify({ title: 'new title' })
		});
		expect(res.status).toBe(404);
	});
});
