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

	// External DOM side effect: enhance <pre> blocks with copy buttons.
	// This is the one legitimate use of $effect — direct DOM manipulation for
	// third-party-rendered HTML that Svelte does not own.
	$effect(() => {
		void html;
		void streaming;
		void copiedIndex;
		if (!container) return;
		const pres = container.querySelectorAll('pre');
		// Remove stale buttons when html changes (more pres than buttons, or fewer)
		// Simplest: ensure each pre has exactly one button, recreate if html changed
		pres.forEach((pre, idx) => {
			let btn = pre.querySelector('[data-copy-btn]') as HTMLButtonElement | null;
			const codeEl = pre.querySelector('code');
			const codeText = codeEl?.textContent ?? pre.textContent ?? '';
			if (!btn) {
				pre.style.position = 'relative';
				btn = document.createElement('button');
				btn.setAttribute('data-copy-btn', String(idx));
				btn.className =
					'absolute right-2 top-2 inline-flex min-h-11 min-w-11 items-center justify-center rounded-md border border-border bg-card px-2 py-1 text-xs text-muted-foreground hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2';
				pre.appendChild(btn);
			}
			// Update click handler with fresh codeText
			const fresh = btn.cloneNode(true) as HTMLButtonElement;
			btn.replaceWith(fresh);
			btn = fresh;
			btn.addEventListener('click', () => handleCopy(idx, codeText));
			const isCopied = copiedIndex === idx;
			btn.setAttribute('aria-label', isCopied ? 'Copied!' : 'Copy code');
			btn.setAttribute('data-copied', String(isCopied));
			btn.innerHTML = isCopied
				? '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>'
				: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>';
		});
		// Remove buttons from pres that no longer exist (if html shrank)
		container.querySelectorAll('[data-copy-btn]').forEach((btn) => {
			const idx = Number(btn.getAttribute('data-copy-btn'));
			if (idx >= pres.length) btn.remove();
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
