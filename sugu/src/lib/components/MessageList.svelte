<script lang="ts">
	import MessageBubble from './MessageBubble.svelte';
	import ToolRow from './ToolRow.svelte';
	import type { DisplayMessage, ToolEntry, ErrEntry } from '$lib/frames';

	type Props = {
		messages: DisplayMessage[];
		tools?: ToolEntry[];
		errs?: ErrEntry[];
		pendingSends?: { id: string; text: string; status: 'pending' | 'sent' | 'failed'; error?: string }[];
		onRerun?: (text: string) => void;
		onRetryPending?: (id: string) => void;
		onDismissPending?: (id: string) => void;
	};

	let { messages, tools = [], errs = [], pendingSends = [], onRerun, onRetryPending, onDismissPending }: Props = $props();

	function toolsForSeq(seq: number): ToolEntry[] {
		return tools.filter((t) => t.seq === seq);
	}

	let scrollEl: HTMLDivElement | null = $state(null);
	let showJump = $state(false);
	let userScrolledUp = $state(false);

	function handleScroll(): void {
		if (!scrollEl) return;
		const { scrollTop, scrollHeight, clientHeight } = scrollEl;
		const nearBottom = scrollHeight - scrollTop - clientHeight < 80;
		showJump = !nearBottom && messages.length > 0;
		userScrolledUp = !nearBottom;
	}

	function jumpToLatest(): void {
		if (!scrollEl) return;
		scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: 'smooth' });
		showJump = false;
		userScrolledUp = false;
	}

	function maybeAutoscroll(): void {
		if (!scrollEl || userScrolledUp) return;
		scrollEl.scrollTop = scrollEl.scrollHeight;
	}

	let prevLen = $state(0);
	let prevLastText = $state('');
	function checkAutoscroll(): string {
		const len = messages.length;
		const lastText = messages[len - 1]?.text ?? '';
		if (len !== prevLen || lastText !== prevLastText) {
			prevLen = len;
			prevLastText = lastText;
			requestAnimationFrame(maybeAutoscroll);
		}
		return '';
	}
</script>

<div
	bind:this={scrollEl}
		onscroll={handleScroll}
		class="flex flex-1 flex-col gap-3 overflow-y-auto p-4"
		role="log"
		aria-live="polite"
		aria-relevant="additions"
>
	{#each messages as msg (msg.seq)}
		<span class="hidden" aria-hidden="true">{checkAutoscroll()}</span>
		<MessageBubble
			role={msg.role}
			text={msg.text}
			streaming={msg.streaming}
			interrupted={msg.interrupted}
			onRerun={msg.interrupted && onRerun ? () => onRerun(msg.text) : undefined}
		/>
		{#each toolsForSeq(msg.seq) as tool (tool.runId)}
			<ToolRow name={tool.name} status={tool.status} summary={tool.summary} />
		{/each}
	{:else}
		<p class="py-8 text-center text-sm text-muted-foreground">No messages yet \u2014 say hello</p>
	{/each}

	{#each pendingSends as p (p.id)}
		<div class={p.status === 'failed' ? 'flex items-center gap-2 rounded-xl border border-destructive/50 bg-card px-4 py-3 text-sm' : 'flex items-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm opacity-60'}>
			<span class="flex-1 truncate">{p.text}</span>
			{#if p.status === 'pending'}
				<span class="text-xs text-muted-foreground">Sending\u2026</span>
			{:else if p.status === 'failed'}
				<span class="text-xs text-destructive">{p.error ?? 'Failed'}</span>
				<button type="button" onclick={() => onRetryPending?.(p.id)} class="min-h-[44px] min-w-[44px] rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">Retry</button>
				<button type="button" onclick={() => onDismissPending?.(p.id)} class="min-h-[44px] min-w-[44px] rounded-md border px-2 py-1 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">Dismiss</button>
			{/if}
		</div>
	{/each}

	{#each errs as e (e.at)}
		<div role="alert" class="rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive">
			<span class="font-medium">{e.code}:</span> {e.message}
		</div>
	{/each}
</div>

{#if showJump}
	<div class="sticky bottom-0 flex justify-center p-2">
		<button type="button" onclick={jumpToLatest} class="min-h-[44px] rounded-full bg-primary px-4 py-2 text-xs font-medium text-primary-foreground shadow-lg focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
			Jump to latest \u2193
		</button>
	</div>
{/if}
