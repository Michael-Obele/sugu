<script lang="ts">
	import { cn } from '$lib/utils';

	type Props = {
		state: 'connecting' | 'open' | 'reconnecting' | 'closed';
	};

	let { state }: Props = $props();

	let visible = $derived(state === 'reconnecting' || state === 'connecting');
	let label = $derived(
		state === 'reconnecting'
			? 'Reconnecting\u2026'
			: state === 'connecting'
				? 'Connecting\u2026'
				: state === 'closed'
					? 'Offline'
					: ''
	);
	let dotClass = $derived(
		state === 'open'
			? 'bg-emerald-500'
			: state === 'reconnecting'
				? 'bg-warning'
				: state === 'connecting'
					? 'bg-muted-foreground'
					: 'bg-destructive'
	);
</script>

{#if visible}
	<div
		role="status"
		aria-live="polite"
		class={cn(
			'flex h-8 items-center justify-center gap-2 bg-warning px-4 text-sm font-medium text-warning-foreground',
			'safe-top'
		)}
	>
		<span class="h-2 w-2 animate-pulse rounded-full bg-warning-foreground" aria-hidden="true"
		></span>
		{label}
	</div>
{:else if state === 'closed'}
	<div
		role="status"
		aria-live="polite"
		class="flex h-8 items-center justify-center gap-2 bg-destructive px-4 text-sm font-medium text-destructive-foreground safe-top"
	>
		<span class="h-2 w-2 rounded-full bg-destructive-foreground" aria-hidden="true"></span>
		Offline \u2014 will reconnect
	</div>
{/if}
