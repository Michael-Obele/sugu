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
		'flex min-h-[44px] w-full min-w-[44px] items-center gap-2 rounded-md border px-3 py-2 text-left text-sm',
		isFailed
			? 'border-warning/50 bg-warning/10 text-warning-foreground'
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
	<div
		class="mt-1 rounded-md border border-warning/30 bg-warning/5 p-3 text-sm text-warning-foreground"
	>
		{summary}
	</div>
{/if}
