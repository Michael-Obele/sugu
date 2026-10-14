import { describe, test, expect } from 'bun:test';
import { JSDOM } from 'jsdom';
import { renderMarkdown } from '../sugu/src/lib/markdown';

function render(md: string): string {
	const dom = new JSDOM('');
	return renderMarkdown(md, { window: dom.window as unknown as Window });
}

describe('renderMarkdown', () => {
	test('bold', () => {
		const html = render('**hello**');
		expect(html).toContain('<strong>hello</strong>');
	});

	test('italic star', () => {
		const html = render('*hello*');
		expect(html).toContain('<em>hello</em>');
	});

	test('italic underscore', () => {
		const html = render('_hello_');
		expect(html).toContain('<em>hello</em>');
	});

	test('inline code', () => {
		const html = render('`code`');
		expect(html).toContain('<code>code</code>');
	});

	test('fenced code with language', () => {
		const html = render('```js\nconsole.log(1)\n```');
		expect(html).toContain('<pre>');
		expect(html).toContain('<code');
		expect(html).toContain('console.log(1)');
	});

	test('ul', () => {
		const html = render('- a\n- b');
		expect(html).toContain('<ul>');
		expect(html).toContain('<li>a</li>');
		expect(html).toContain('<li>b</li>');
	});

	test('ol', () => {
		const html = render('1. a\n2. b');
		expect(html).toContain('<ol>');
		expect(html).toContain('<li>a</li>');
		expect(html).toContain('<li>b</li>');
	});

	test('nested list', () => {
		const html = render('- a\n  - b\n  - c\n- d');
		expect(html).toContain('<ul>');
		// Should have at least 4 li elements (a, b, c, d)
		const liCount = (html.match(/<li>/g) ?? []).length;
		expect(liCount).toBeGreaterThanOrEqual(4);
	});

	test('heading', () => {
		expect(render('# H1')).toContain('<h1');
		expect(render('## H2')).toContain('<h2');
		expect(render('### H3')).toContain('<h3');
		expect(render('#### H4')).toContain('<h4');
		expect(render('##### H5')).toContain('<h5');
		expect(render('###### H6')).toContain('<h6');
	});

	test('blockquote', () => {
		const html = render('> quote');
		expect(html).toContain('<blockquote>');
		expect(html).toContain('quote');
	});

	test('link', () => {
		const html = render('[text](https://example.com)');
		expect(html).toContain('<a');
		expect(html).toContain('href="https://example.com"');
		expect(html).toContain('target="_blank"');
		expect(html).toContain('rel="noopener noreferrer"');
	});

	test('table', () => {
		const html = render('| a | b |\n|---|---|\n| 1 | 2 |');
		expect(html).toContain('<table>');
		expect(html).toContain('<th');
		expect(html).toContain('<td');
	});

	test('hr', () => {
		const html = render('---');
		expect(html).toContain('<hr');
	});

	test('plain-text newlines', () => {
		const html = render('line one\nline two');
		expect(html).toContain('line one');
		expect(html).toContain('line two');
		expect(html).toContain('<br');
	});

	test('empty string', () => {
		expect(render('')).toBe('');
		expect(render('   ')).toBe('');
		expect(render('\n\n')).toBe('');
	});

	test('unterminated fence does not throw', () => {
		expect(() => render('```js\nconsole.log(1)\n')).not.toThrow();
		const html = render('```js\nconsole.log(1)\n');
		// Should still produce something, not crash
		expect(html.length).toBeGreaterThan(0);
	});

	test('half-written bold does not throw', () => {
		expect(() => render('**hello')).not.toThrow();
		expect(() => render('**')).not.toThrow();
	});

	test('lone backtick does not throw', () => {
		expect(() => render('`')).not.toThrow();
		expect(() => render('hello ` world')).not.toThrow();
	});

	// XSS attacks
	test('script tag removed', () => {
		const html = render('<script>alert(1)</script>');
		expect(html).not.toContain('<script');
		expect(html).not.toContain('alert(1)');
	});

	test('img onerror removed', () => {
		const html = render('<img src=x onerror=alert(1)>');
		expect(html).not.toContain('onerror');
		expect(html).not.toContain('<img');
	});

	test('javascript: URL removed', () => {
		const html = render('[x](javascript:alert(1))');
		expect(html).not.toContain('javascript:');
	});

	test('iframe removed', () => {
		const html = render('<iframe src="//evil"></iframe>');
		expect(html).not.toContain('<iframe');
		expect(html).not.toContain('evil');
	});

	test('div onclick removed', () => {
		const html = render('<div onclick="alert(1)">hello</div>');
		expect(html).not.toContain('onclick');
		expect(html).not.toContain('<div');
	});

	test('svg removed', () => {
		const html = render('<svg onload=alert(1)>');
		expect(html).not.toContain('<svg');
		expect(html).not.toContain('onload');
	});

	test('data: URL removed', () => {
		const html = render('[x](data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==)');
		expect(html).not.toContain('data:');
	});

	test('vbscript: URL removed', () => {
		const html = render('[x](vbscript:msgbox(1))');
		expect(html).not.toContain('vbscript:');
	});

	test('style tag removed', () => {
		const html = render('<style>body{color:red}</style>');
		expect(html).not.toContain('<style');
	});

	test('paragraphs', () => {
		const html = render('para one\n\npara two');
		expect(html).toContain('<p>para one</p>');
		expect(html).toContain('<p>para two</p>');
	});
});
