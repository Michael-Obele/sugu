<script lang="ts">
	import { renderMarkdown } from '$lib/markdown.js';

	let { text, streaming = false }: { text: string; streaming?: boolean } = $props();

	let html = $derived(renderMarkdown(text));

	let container: HTMLDivElement | null = $state(null);
	let copiedIndex: number | null = $state(null);
	let copyTimeout: ReturnType<typeof setTimeout> | null = null;

	function handleCopy(index: number, code: string) {
		navigator.clipboard.writeText(code).then(() => {
			copiedIndex = index;
			if (copyTimeout) clearTimeout(copyTimeout);
			copyTimeout = setTimeout(() => {
				copiedIndex = null;
			}, 1500);
		});
	}

	// External DOM side effect: enhance <pre> blocks with header + copy button.
	// This is the one legitimate use of $effect — direct DOM manipulation for
	// third-party-rendered HTML that Svelte does not own.
	$effect(() => {
		void html;
		void streaming;
		void copiedIndex;
		if (!container) return;
		const pres = Array.from(container.querySelectorAll('pre')) as HTMLPreElement[];
		// Wrap any unwrapped <pre> into header + scroll structure so the copy
		// button never overlaps code and long lines scroll inside their container.
		pres.forEach((pre, idx) => {
			if (pre.dataset.enhanced === 'true') return;
			const codeEl = pre.querySelector('code');
			const codeText = codeEl?.textContent ?? pre.textContent ?? '';
			const langMatch = codeEl?.className.match(/language-([\w-]+)/);
			const lang = langMatch?.[1] ?? '';
			const wrapper = document.createElement('div');
			wrapper.setAttribute('data-code-block', String(idx));
			wrapper.className =
				'my-2 max-w-full min-w-0 overflow-hidden rounded-md border border-border bg-muted';
			const header = document.createElement('div');
			header.setAttribute('data-code-header', '');
			header.className =
				'flex items-center justify-between gap-2 border-b border-border bg-muted px-3 py-1';
			const langEl = document.createElement('span');
			langEl.setAttribute('data-lang', lang);
			langEl.className = 'text-xs font-mono text-muted-foreground';
			langEl.textContent = lang || 'code';
			const btn = document.createElement('button');
			btn.setAttribute('data-copy-btn', String(idx));
			btn.setAttribute('data-code-text', codeText);
			btn.className =
				'inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
			header.append(langEl, btn);
			const scroll = document.createElement('div');
			scroll.setAttribute('data-code-scroll', '');
			scroll.className = 'max-w-full overflow-x-auto p-3';
			pre.className = 'm-0 !bg-transparent !p-0 font-mono text-sm';
			pre.style.overflow = 'visible';
			pre.style.position = '';
			pre.style.backgroundColor = 'transparent';
			pre.style.padding = '0';
			pre.style.margin = '0';
			if (codeEl) {
				codeEl.className = '!bg-transparent !p-0 font-mono text-sm whitespace-pre';
				(codeEl as HTMLElement).style.backgroundColor = 'transparent';
			} else {
				pre.style.whiteSpace = 'pre';
			}
			pre.dataset.enhanced = 'true';
			pre.parentNode?.insertBefore(wrapper, pre);
			wrapper.append(header, scroll);
			scroll.appendChild(pre);
		});
		// Update all copy buttons for current copiedIndex (label, icon, handler)
		const wrappers = container.querySelectorAll('[data-code-block]');
		wrappers.forEach((wrapper, idx) => {
			const btn = wrapper.querySelector('[data-copy-btn]') as HTMLButtonElement | null;
			const pre = wrapper.querySelector('pre');
			const codeEl = pre?.querySelector('code');
			const codeText =
				codeEl?.textContent ?? pre?.textContent ?? btn?.getAttribute('data-code-text') ?? '';
			if (!btn) return;
			btn.setAttribute('data-code-text', codeText);
			const fresh = btn.cloneNode(true) as HTMLButtonElement;
			btn.replaceWith(fresh);
			const newBtn = fresh;
			newBtn.addEventListener('click', () => handleCopy(idx, codeText));
			const isCopied = copiedIndex === idx;
			newBtn.setAttribute('aria-label', isCopied ? 'Copied!' : 'Copy code');
			newBtn.setAttribute('data-copied', String(isCopied));
			newBtn.innerHTML = isCopied
				? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
				: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
		});
	});
</script>

{#if html}
	<div
		bind:this={container}
		class="markdown-content max-w-full min-w-0 text-sm leading-relaxed wrap-break-word
			[&_a]:text-primary [&_a]:underline
			[&_a]:underline-offset-2 hover:[&_a]:text-primary/80 [&_blockquote]:my-2 [&_blockquote]:border-l-2
			[&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_blockquote]:italic
			[&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:py-0.5
			[&_code]:font-mono [&_code]:text-sm [&_em]:italic [&_h1]:mt-4
			[&_h1]:mb-2 [&_h1]:text-2xl [&_h1]:font-bold [&_h2]:mt-4
			[&_h2]:mb-2 [&_h2]:text-xl [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1
			[&_h3]:text-lg [&_h3]:font-semibold [&_h4]:mt-3
			[&_h4]:mb-1 [&_h4]:text-base [&_h4]:font-semibold
			[&_h5]:mt-2
			[&_h5]:mb-1 [&_h5]:text-sm [&_h5]:font-semibold [&_h6]:mt-2 [&_h6]:mb-1 [&_h6]:text-sm
			[&_h6]:font-medium [&_h6]:text-muted-foreground [&_hr]:my-4 [&_hr]:border-border
			[&_li]:my-1 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:my-2 [&_p]:leading-relaxed
			[&_pre]:my-2 [&_pre]:overflow-x-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-sm
			[&_pre_code]:bg-transparent [&_pre_code]:p-0
			[&_strong]:font-semibold [&_table]:my-2
			[&_table]:w-full [&_table]:border-collapse [&_td]:border
			[&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-border [&_th]:bg-muted [&_th]:px-2
			[&_th]:py-1 [&_th]:text-left [&_th]:font-medium [&_ul]:my-2
			[&_ul]:list-disc
			[&_ul]:pl-6"
	>
		<!-- {@html} is safe here: html is sanitized by DOMPurify in renderMarkdown (R2) -->
		{@html html}
	</div>
{/if}
