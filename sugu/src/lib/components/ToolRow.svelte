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
	};

	let { name, status, summary }: Props = $props();

	function truncate(
		text: string,
		max = 800
	): { display: string; truncated: boolean; hidden: number } {
		if (text.length <= max) return { display: text, truncated: false, hidden: 0 };
		return { display: text.slice(0, max), truncated: true, hidden: text.length - max };
	}

	let trunc = $derived(summary ? truncate(summary) : null);
</script>

<Collapsible.Root class="w-full">
	<Collapsible.Trigger
		class={cn(
			'flex min-h-[44px] w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm',
			status === 'failed'
				? 'border-destructive/50 bg-destructive/10 text-destructive'
				: 'border-border bg-card text-muted-foreground'
		)}
		aria-label={`Tool ${name} ${status}`}
	>
		<span class="font-mono text-xs truncate">ran `{name}`</span>
		{#if status === 'ok'}
			<Badge variant="secondary" class="ml-auto text-xs">ok</Badge>
		{:else if status === 'failed'}
			<Badge variant="destructive" class="ml-auto text-xs">failed</Badge>
		{:else}
			<Spinner class="ml-auto size-3" />
		{/if}
		{#if summary}
			<ChevronDownIcon
				class="size-4 shrink-0 opacity-50 group-data-[state=open]/collapsible:rotate-180 transition-transform"
			/>
		{/if}
	</Collapsible.Trigger>
	{#if summary && trunc}
		<Collapsible.Content class="mt-1 rounded-md border bg-card p-3 text-sm">
			<pre class="whitespace-pre-wrap break-words text-xs">{trunc.display}</pre>
			{#if trunc.truncated}
				<p class="mt-2 text-xs text-muted-foreground">
					Output truncated — {trunc.hidden} chars hidden
				</p>
			{/if}
		</Collapsible.Content>
	{/if}
</Collapsible.Root>
