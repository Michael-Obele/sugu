import { marked } from 'marked';
import createDOMPurify from 'dompurify';

// Configure marked once — GFM + breaks (single newline → <br>)
marked.setOptions({ gfm: true, breaks: true });

const ALLOWED_TAGS = [
	'p',
	'br',
	'strong',
	'em',
	'b',
	'i',
	'code',
	'pre',
	'ul',
	'ol',
	'li',
	'h1',
	'h2',
	'h3',
	'h4',
	'h5',
	'h6',
	'blockquote',
	'a',
	'hr',
	'table',
	'thead',
	'tbody',
	'tr',
	'th',
	'td'
];

function isDangerousUrl(url: string): boolean {
	const trimmed = url.trim().toLowerCase();
	return (
		trimmed.startsWith('javascript:') ||
		trimmed.startsWith('data:') ||
		trimmed.startsWith('vbscript:')
	);
}

/** Render untrusted markdown to sanitized HTML. `opts.window` exists for tests; the
 *  SPA passes nothing and the module binds the real DOMPurify to the real window. */
export function renderMarkdown(markdown: string, opts?: { window?: Window }): string {
	if (!markdown || !markdown.trim()) return '';

	let raw: string;
	try {
		const parsed = marked.parse(markdown, { gfm: true, breaks: true });
		raw = typeof parsed === 'string' ? parsed : '';
	} catch {
		// Streaming-safe: never throw on half-written markdown
		raw = markdown;
	}

	// Resolve window: test passes JSDOM window, SPA uses global window
	const win =
		(opts?.window as unknown as Window) ?? (typeof window !== 'undefined' ? window : undefined);
	if (!win) return '';

	// Create a fresh DOMPurify instance bound to this window
	const DOMPurify = (createDOMPurify as unknown as (w: Window) => unknown)(
		win as unknown as Window
	) as unknown as {
		addHook: (type: string, fn: (node: Element) => void) => void;
		removeHook: (type: string) => void;
		sanitize: (html: string, opts: Record<string, unknown>) => string;
	};

	// Hook to enforce link target/rel and strip dangerous URLs + on* attributes
	DOMPurify.addHook('afterSanitizeAttributes', (node: Element) => {
		// Strip any on* attribute that slipped through
		for (const attr of node.attributes) {
			if (/^on/i.test(attr.name)) {
				node.removeAttribute(attr.name);
			}
		}
		// Handle href/src dangerous protocols
		if (node.hasAttribute('href')) {
			const href = node.getAttribute('href') ?? '';
			if (isDangerousUrl(href)) {
				node.removeAttribute('href');
			} else if (node.tagName === 'A') {
				node.setAttribute('target', '_blank');
				node.setAttribute('rel', 'noopener noreferrer');
			}
		}
		if (node.hasAttribute('src')) {
			const src = node.getAttribute('src') ?? '';
			if (isDangerousUrl(src)) {
				node.removeAttribute('src');
			}
		}
		// Ensure every <a> has target/rel even if href was safe but hook didn't set it
		if (node.tagName === 'A' && node.hasAttribute('href')) {
			if (!node.hasAttribute('target')) node.setAttribute('target', '_blank');
			if (!node.hasAttribute('rel')) node.setAttribute('rel', 'noopener noreferrer');
		}
	});

	const clean = DOMPurify.sanitize(raw, {
		ALLOWED_TAGS,
		FORBID_ATTR: ['style']
	});

	DOMPurify.removeHook('afterSanitizeAttributes');

	return (clean as string).trim();
}
