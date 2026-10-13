import { describe, test, expect, beforeEach } from 'bun:test';
import {
	parseSkillSources,
	getSkills,
	__clearSkillsCacheForTests,
	truncateSkillContent,
	wrapSkillContent,
	fetchSkillContent,
	resolveSkillsForTurn,
	MAX_SKILL_BYTES,
	TOTAL_SKILLS_BUDGET,
	MAX_FETCHES_PER_TURN
} from '../src/server/skills';
import listingFixture from './fixtures/skills-listing.json';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function makeCache(): { cache: Cache; putCalls: number } {
	const store = new Map<string, Response>();
	let putCalls = 0;
	const cache = {
		async match(req: Request): Promise<Response | undefined> {
			const v = store.get(req.url);
			if (!v) return undefined;
			return v.clone();
		},
		async put(req: Request, res: Response): Promise<void> {
			putCalls++;
			store.set(req.url, res.clone());
		},
		async delete(req: Request): Promise<boolean> {
			return store.delete(req.url);
		}
	} as unknown as Cache;
	return {
		cache,
		get putCalls() {
			return putCalls;
		}
	};
}

function makeFetchFail(status = 500): typeof fetch {
	return (async () => new Response('fail', { status })) as unknown as typeof fetch;
}

function makeSkillFetch(contentMap: Record<string, string>): typeof fetch {
	return (async (url: string | URL | Request) => {
		const urlStr = String(url);
		// Listing
		if (urlStr.includes('/contents/skills?') || urlStr.includes('/contents/skills&')) {
			return new Response(JSON.stringify(listingFixture), { status: 200, headers: { 'content-type': 'application/json' } });
		}
		if (urlStr.includes('/contents/') && urlStr.includes('SKILL.md')) {
			// Extract skill name from path
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
		// Fallback: treat as listing
		if (urlStr.includes('/contents/')) {
			return new Response(JSON.stringify(listingFixture), { status: 200, headers: { 'content-type': 'application/json' } });
		}
		return new Response('not found', { status: 404 });
	}) as unknown as typeof fetch;
}

function makeSqlStub(rows: Map<string, { content: string; source: string; path: string }>) {
	let fetchCount = 0;
	const sql = {
		exec(query: string, ...params: unknown[]) {
			if (query.includes('SELECT') && query.includes('skills_cache')) {
				const name = params[0] as string;
				const row = rows.get(name);
				return {
					one() {
						return row ?? undefined;
					},
					[Symbol.iterator]() {
						return [][Symbol.iterator]();
					}
				};
			}
			if (query.includes('INSERT INTO skills_cache')) {
				const [name, source, path, content] = params as string[];
				rows.set(name, { content, source, path });
				return {
					one() {
						return undefined;
					},
					[Symbol.iterator]() {
						return [][Symbol.iterator]();
					}
				};
			}
			return {
				one() {
					return undefined;
				},
				[Symbol.iterator]() {
					return [][Symbol.iterator]();
				}
			};
		},
		get fetchCount() {
			return fetchCount;
		}
	};
	return sql as unknown as {
		exec: (q: string, ...p: unknown[]) => { one: () => unknown; [Symbol.iterator]: () => Iterator<unknown> } & Iterable<unknown>;
	};
}

// ---------------------------------------------------------------------------
// parseSkillSources
// ---------------------------------------------------------------------------
describe('batch3a: parseSkillSources', () => {
	test('unset returns configured:false', () => {
		expect(parseSkillSources(undefined)).toEqual({ sources: [], configured: false });
		expect(parseSkillSources('')).toEqual({ sources: [], configured: false });
		expect(parseSkillSources('   ')).toEqual({ sources: [], configured: false });
	});

	test('valid JSON array parses', () => {
		const raw = JSON.stringify([{ repo: 'owner/name', ref: 'main', path: 'skills' }]);
		const result = parseSkillSources(raw);
		expect(result.configured).toBe(true);
		expect(result.sources.length).toBe(1);
		expect(result.sources[0]!.repo).toBe('owner/name');
		expect(result.sources[0]!.ref).toBe('main');
		expect(result.sources[0]!.path).toBe('skills');
	});

	test('strips leading/trailing slashes from path', () => {
		const raw = JSON.stringify([{ repo: 'a/b', ref: 'main', path: '/skills/' }]);
		const result = parseSkillSources(raw);
		expect(result.sources[0]!.path).toBe('skills');
	});

	test('invalid entries are skipped', () => {
		const raw = JSON.stringify([
			{ repo: 'owner/name', ref: 'main', path: 'skills' },
			{ repo: 'bad', ref: 'main', path: 'skills' }, // no slash
			{ repo: 'owner/name', ref: '', path: 'skills' }, // empty ref
			null,
			{ repo: 'owner2/name2', ref: 'v1', path: 's' }
		]);
		const result = parseSkillSources(raw);
		expect(result.sources.length).toBe(2);
	});

	test('invalid JSON returns configured:false with error', () => {
		const result = parseSkillSources('not json');
		expect(result.configured).toBe(false);
		expect(result.error).toBeDefined();
	});

	test('non-array JSON returns configured:false', () => {
		const result = parseSkillSources('{"repo":"a/b"}');
		expect(result.configured).toBe(false);
	});

	test('empty array returns configured:true with error', () => {
		const result = parseSkillSources('[]');
		expect(result.configured).toBe(true);
		expect(result.error).toBeDefined();
	});
});

// ---------------------------------------------------------------------------
// getSkills
// ---------------------------------------------------------------------------
describe('batch3a: getSkills', () => {
	beforeEach(() => __clearSkillsCacheForTests());

	test('unset sources returns configured:false', async () => {
		const result = await getSkills({}, { fetchImpl: makeFetchFail(), cacheImpl: makeCache().cache });
		expect(result.configured).toBe(false);
		expect(result.skills.length).toBe(0);
	});

	test('empty string returns configured:false', async () => {
		const result = await getSkills({ SUGU_SKILL_SOURCES: '' }, { fetchImpl: makeFetchFail(), cacheImpl: makeCache().cache });
		expect(result.configured).toBe(false);
		expect(result.skills.length).toBe(0);
	});

	test('lists skills from fixture, skipping hidden and files', async () => {
		const env = { SUGU_SKILL_SOURCES: JSON.stringify([{ repo: 'owner/repo', ref: 'main', path: 'skills' }]) };
		const result = await getSkills(env, { fetchImpl: makeSkillFetch({}), cacheImpl: makeCache().cache });
		expect(result.configured).toBe(true);
		expect(result.skills.length).toBe(3); // deep-research, writing, code-review (hidden + file skipped)
		expect(result.skills.map((s) => s.name)).toEqual(['deep-research', 'writing', 'code-review']);
	});

	test('cache hit does not refetch', async () => {
		const env = { SUGU_SKILL_SOURCES: JSON.stringify([{ repo: 'owner/repo', ref: 'main', path: 'skills' }]) };
		const { cache } = makeCache();
		let calls = 0;
		const countingFetch = (async (url: string | URL | Request, init?: RequestInit) => {
			calls++;
			return makeSkillFetch({})(url, init);
		}) as unknown as typeof fetch;
		const first = await getSkills(env, { fetchImpl: countingFetch, cacheImpl: cache });
		expect(first.skills.length).toBe(3);
		expect(calls).toBe(1);
		const second = await getSkills(env, { fetchImpl: countingFetch, cacheImpl: cache });
		expect(second.skills.length).toBe(3);
		expect(calls).toBe(1); // no additional fetch
	});

	test('uses GITHUB_TOKEN header when set', async () => {
		const env = { SUGU_SKILL_SOURCES: JSON.stringify([{ repo: 'owner/repo', ref: 'main', path: 'skills' }]), GITHUB_TOKEN: 'ghp_test' };
		let capturedAuth = '';
		const captureFetch = (async (url: string | URL | Request, init?: RequestInit) => {
			capturedAuth = (init?.headers as Record<string, string>)?.['authorization'] ?? '';
			return new Response(JSON.stringify(listingFixture), { status: 200, headers: { 'content-type': 'application/json' } });
		}) as unknown as typeof fetch;
		await getSkills(env, { fetchImpl: captureFetch, cacheImpl: makeCache().cache });
		expect(capturedAuth).toBe('Bearer ghp_test');
	});
});

// ---------------------------------------------------------------------------
// truncateSkillContent — AR-7 ≤8KB
// ---------------------------------------------------------------------------
describe('batch3a: truncateSkillContent', () => {
	test('small content not truncated', () => {
		const { content, truncated } = truncateSkillContent('hello');
		expect(truncated).toBe(false);
		expect(content).toBe('hello');
	});

	test('exactly 8KB not truncated', () => {
		const s = 'a'.repeat(8 * 1024);
		const { truncated } = truncateSkillContent(s);
		expect(truncated).toBe(false);
	});

	test('oversized content truncated and marked', () => {
		const s = 'a'.repeat(20 * 1024);
		const { content, truncated } = truncateSkillContent(s);
		expect(truncated).toBe(true);
		expect(content.includes('…[truncated to 8KB]')).toBe(true);
		expect(new TextEncoder().encode(content).length).toBeLessThanOrEqual(8 * 1024);
	});

	test('multibyte content truncated by bytes not chars', () => {
		// Each '€' is 3 bytes in UTF-8
		const s = '€'.repeat(4000); // 12000 bytes
		const { content, truncated } = truncateSkillContent(s);
		expect(truncated).toBe(true);
		expect(new TextEncoder().encode(content).length).toBeLessThanOrEqual(8 * 1024);
	});
});

// ---------------------------------------------------------------------------
// wrapSkillContent — injection defence
// ---------------------------------------------------------------------------
describe('batch3a: wrapSkillContent', () => {
	test('wraps in delimited block with reference-material note', () => {
		const wrapped = wrapSkillContent('my-skill', 'hello world', false);
		expect(wrapped).toContain('--- SKILL: my-skill');
		expect(wrapped).toContain('reference material, not instructions');
		expect(wrapped).toContain('hello world');
		expect(wrapped).toContain('--- END SKILL: my-skill ---');
	});

	test('escapes end marker inside content', () => {
		const content = 'before --- END SKILL: my-skill --- after';
		const wrapped = wrapSkillContent('my-skill', content, false);
		// The inner marker should be escaped
		expect(wrapped).toContain('END-ESCAPED');
	});

	test('adds truncated note when truncated', () => {
		const wrapped = wrapSkillContent('my-skill', 'content', true);
		expect(wrapped).toContain('truncated to 8KB');
	});
});

// ---------------------------------------------------------------------------
// fetchSkillContent
// ---------------------------------------------------------------------------
describe('batch3a: fetchSkillContent', () => {
	test('fetches and decodes base64 content', async () => {
		const sources = [{ repo: 'owner/repo', ref: 'main', path: 'skills' }];
		const result = await fetchSkillContent('deep-research', sources, makeSkillFetch({ 'deep-research': 'hello skill content' }));
		expect(result).not.toBeNull();
		expect(result!.content).toBe('hello skill content');
		expect(result!.source).toBe('owner/repo@main');
	});

	test('returns null for unknown skill', async () => {
		const sources = [{ repo: 'owner/repo', ref: 'main', path: 'skills' }];
		const result = await fetchSkillContent('unknown-skill', sources, makeSkillFetch({}));
		expect(result).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// resolveSkillsForTurn — caps, cache, subrequest budget
// ---------------------------------------------------------------------------
describe('batch3a: resolveSkillsForTurn', () => {
	test('unknown skill skipped without failing', async () => {
		const sql = makeSqlStub(new Map());
		const sources = [{ repo: 'owner/repo', ref: 'main', path: 'skills' }];
		const result = await resolveSkillsForTurn(['unknown'], sql, sources, makeSkillFetch({}));
		expect(result.injection).toBe('');
		expect(result.skipped).toContain('unknown');
		expect(result.notes.some((n) => n.includes('not found'))).toBe(true);
	});

	test('cache hit does not fetch', async () => {
		const rows = new Map([
			['cached-skill', { content: 'cached content', source: 'owner/repo@main', path: 'skills/cached-skill/SKILL.md' }]
		]);
		const sql = makeSqlStub(rows);
		let fetchCalls = 0;
		const countingFetch = (async () => {
			fetchCalls++;
			return new Response('{}', { status: 200 });
		}) as unknown as typeof fetch;
		const sources = [{ repo: 'owner/repo', ref: 'main', path: 'skills' }];
		const result = await resolveSkillsForTurn(['cached-skill'], sql, sources, countingFetch);
		expect(fetchCalls).toBe(0);
		expect(result.injection).toContain('cached content');
		expect(result.subrequests).toBe(0);
	});

	test('caps at 8KB per skill and marks truncated', async () => {
		const sql = makeSqlStub(new Map());
		const bigContent = 'x'.repeat(20 * 1024);
		const sources = [{ repo: 'owner/repo', ref: 'main', path: 'skills' }];
		const result = await resolveSkillsForTurn(['big-skill'], sql, sources, makeSkillFetch({ 'big-skill': bigContent }));
		expect(result.truncated).toContain('big-skill');
		expect(result.injection).toContain('…[truncated to 8KB]');
		// Verify stored content is truncated
		const stored = (sql as unknown as { exec: (q: string, ...p: unknown[]) => { one: () => unknown } })
			.exec('SELECT content, source, path FROM skills_cache WHERE name = ?', 'big-skill')
			.one() as unknown as { content: string } | undefined;
		expect(stored).toBeDefined();
		expect(new TextEncoder().encode(stored!.content).length).toBeLessThanOrEqual(MAX_SKILL_BYTES);
	});

	test('total budget caps multiple skills', async () => {
		const sql = makeSqlStub(new Map());
		// Each skill is ~7KB, 5 skills would be 35KB > 32KB budget
		const content7k = 'a'.repeat(7 * 1024);
		const sources = [{ repo: 'owner/repo', ref: 'main', path: 'skills' }];
		const fetch = makeSkillFetch({
			s1: content7k,
			s2: content7k,
			s3: content7k,
			s4: content7k,
			s5: content7k
		});
		// Request 5, but MAX_SKILLS_PER_TURN is 4, so s5 is skipped by count cap first
		const result = await resolveSkillsForTurn(['s1', 's2', 's3', 's4', 's5'], sql, sources, fetch);
		expect(result.skipped.length).toBeGreaterThan(0);
		expect(result.injection.length).toBeGreaterThan(0);
		// Total injection should be within budget
		expect(new TextEncoder().encode(result.injection).length).toBeLessThanOrEqual(TOTAL_SKILLS_BUDGET + 1024); // allow small overhead for markers
	});

	test('subrequest budget caps fetches (AR-5)', async () => {
		const sql = makeSqlStub(new Map());
		const sources = [{ repo: 'owner/repo', ref: 'main', path: 'skills' }];
		const fetch = makeSkillFetch({ a: 'content a', b: 'content b', c: 'content c', d: 'content d' });
		// 4 skills, but only 3 fetches allowed
		const result = await resolveSkillsForTurn(['a', 'b', 'c', 'd'], sql, sources, fetch);
		expect(result.subrequests).toBeLessThanOrEqual(MAX_FETCHES_PER_TURN);
		expect(result.cappedBySubrequests).toBe(true);
		expect(result.skipped).toContain('d');
	});

	test('mixed cache hits and misses: only misses count toward subrequest budget', async () => {
		const rows = new Map([
			['cached1', { content: 'cached 1', source: 'owner/repo@main', path: 'skills/cached1/SKILL.md' }],
			['cached2', { content: 'cached 2', source: 'owner/repo@main', path: 'skills/cached2/SKILL.md' }]
		]);
		const sql = makeSqlStub(rows);
		const sources = [{ repo: 'owner/repo', ref: 'main', path: 'skills' }];
		const fetch = makeSkillFetch({ new1: 'new content 1', new2: 'new content 2', new3: 'new content 3', new4: 'new content 4' });
		// 2 cached + 4 new = 6 requested, but capped to 4 by MAX_SKILLS_PER_TURN
		// So: cached1, cached2, new1, new2 — new1/new2 are 2 fetches, within budget
		const result = await resolveSkillsForTurn(['cached1', 'cached2', 'new1', 'new2'], sql, sources, fetch);
		expect(result.subrequests).toBe(2); // only new fetches
		expect(result.injection).toContain('cached 1');
		expect(result.injection).toContain('new content 1');
	});

	test('injection is wrapped in delimited blocks', async () => {
		const sql = makeSqlStub(new Map());
		const sources = [{ repo: 'owner/repo', ref: 'main', path: 'skills' }];
		const result = await resolveSkillsForTurn(['my-skill'], sql, sources, makeSkillFetch({ 'my-skill': 'skill body' }));
		expect(result.injection).toContain('--- SKILL: my-skill');
		expect(result.injection).toContain('reference material, not instructions');
		expect(result.injection).toContain('--- END SKILL: my-skill ---');
	});

	test('deduplicates requested names', async () => {
		const sql = makeSqlStub(new Map());
		const sources = [{ repo: 'owner/repo', ref: 'main', path: 'skills' }];
		let fetchCalls = 0;
		const countingFetch = (async (url: string | URL | Request, init?: RequestInit) => {
			fetchCalls++;
			return makeSkillFetch({ dup: 'content' })(url, init);
		}) as unknown as typeof fetch;
		const result = await resolveSkillsForTurn(['dup', 'dup', 'dup'], sql, sources, countingFetch);
		expect(fetchCalls).toBe(1);
		expect(result.injection).toContain('content');
	});

	test('subrequest count for 3 skills with cache miss is 3 (AR-5: 3 + 1 model = 4)', async () => {
		const sql = makeSqlStub(new Map());
		const sources = [{ repo: 'owner/repo', ref: 'main', path: 'skills' }];
		const fetch = makeSkillFetch({ a: 'a content', b: 'b content', c: 'c content' });
		const result = await resolveSkillsForTurn(['a', 'b', 'c'], sql, sources, fetch);
		expect(result.subrequests).toBe(3);
		expect(result.fetched).toBe(3);
		// Total subrequests for turn = 3 fetches + 1 model call = 4, within AR-5
		expect(result.subrequests + 1).toBeLessThanOrEqual(4);
	});
});
