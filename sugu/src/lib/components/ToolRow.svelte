<script lang="ts">
	import { cn } from '$lib/utils';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';

	type Props = {
		name: string;
		status: 'running' | 'ok' | 'failed';
		summary?: string;
		durationMs?: number;
		truncated?: boolean;
		detailLevel?: 'compact' | 'full';
	};

	let { name, status, summary, durationMs, truncated, detailLevel = 'compact' }: Props = $props();

	function truncate(
		text: string,
		max = 800
	): { display: string; truncated: boolean; hidden: number } {
		if (text.length <= max) return { display: text, truncated: false, hidden: 0 };
		return { display: text.slice(0, max), truncated: true, hidden: text.length - max };
	}

	let trunc = $derived(summary ? truncate(summary) : null);
	let isTruncated = $derived(truncated ?? trunc?.truncated ?? false);
</script>

<Collapsible.Root class="w-full">
	<Collapsible.Trigger
		class={cn(
			'flex min-h-11 w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
			status === 'failed'
				? 'border-destructive/50 bg-destructive/10 text-destructive'
				: 'border-border bg-card text-muted-foreground'
		)}
		aria-label={`Tool ${name} ${status}${durationMs !== undefined ? ` ${durationMs}ms` : ''}`}
		disabled={detailLevel === 'compact'}
	>
		<span class="font-mono text-xs truncate">ran `{name}`</span>
		{#if durationMs !== undefined}
			<span class="text-xs text-muted-foreground tabular-nums">{durationMs}ms</span>
		{/if}
		{#if status === 'ok'}
			<Badge variant="secondary" class="ml-auto text-xs">ok</Badge>
		{:else if status === 'failed'}
			<Badge variant="destructive" class="ml-auto text-xs">failed</Badge>
		{:else}
			<Spinner class="ml-auto size-3" />
		{/if}
		{#if detailLevel === 'full' && summary}
			<ChevronDownIcon
				class="size-4 shrink-0 opacity-50 group-data-[state=open]/collapsible:rotate-180 transition-transform"
			/>
		{/if}
	</Collapsible.Trigger>
	{#if detailLevel === 'full' && summary && trunc}
		<Collapsible.Content class="mt-1 rounded-md border bg-card p-3 text-sm">
			<pre class="whitespace-pre-wrap wrap-break-word text-xs">{trunc.display}</pre>
			{#if isTruncated}
				<p class="mt-2 text-xs text-muted-foreground">
					…[truncated to 48KB] — {trunc.hidden > 0
						? `${trunc.hidden} chars hidden`
						: 'output truncated'}
				</p>
			{/if}
			{#if status === 'failed'}
				<p class="mt-2 text-xs text-destructive">Tool failed — error details above</p>
			{/if}
		</Collapsible.Content>
	{/if}
</Collapsible.Root>
