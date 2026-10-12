<script lang="ts">
	import { cn } from '$lib/utils';

	type Props = {
		name: string;
		status: 'running' | 'ok' | 'failed';
		summary?: string;
	};

	let { name, status, summary }: Props = $props();

	let expanded = $state(false);
	let isFailed = $derived(status === 'failed');
</script>

<button
	type="button"
	onclick={() => {
		if (isFailed) expanded = !expanded;
	}}
	disabled={!isFailed}
	class={cn(
		'flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm',
		isFailed
			? 'border-amber-500/50 bg-amber-500/10 text-amber-200'
			: 'border-border bg-card text-muted-foreground',
		isFailed && 'cursor-pointer'
	)}
	aria-expanded={isFailed ? expanded : undefined}
>
	<span class="font-mono text-xs">ran `{name}`</span>
	{#if status === 'ok'}
		<span class="text-xs">✓</span>
	{/if}
	{#if status === 'failed'}
		<span class="text-xs">✗</span>
	{/if}
	{#if summary}
		<span class="ml-auto text-xs opacity-70">{summary}</span>
	{/if}
</button>

{#if isFailed && expanded && summary}
	<div class="mt-1 rounded-md border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-amber-100">
		{summary}
	</div>
{/if}
