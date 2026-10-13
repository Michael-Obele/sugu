<script lang="ts">
	import { cn } from '$lib/utils';
	import { Spinner } from '$lib/components/ui/spinner/index.js';

	type Props = {
		state: 'connecting' | 'open' | 'reconnecting' | 'closed';
	};

	let { state }: Props = $props();

	let visible = $derived(state === 'reconnecting' || state === 'connecting');
	let label = $derived(
		state === 'reconnecting'
			? 'Reconnecting…'
			: state === 'connecting'
				? 'Connecting…'
				: state === 'closed'
					? 'Offline'
					: ''
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
		<Spinner class="size-4 text-warning-foreground" />
		{label}
	</div>
{:else if state === 'closed'}
	<div
		role="status"
		aria-live="polite"
		class="flex h-8 items-center justify-center gap-2 bg-destructive px-4 text-sm font-medium text-destructive-foreground safe-top"
	>
		<span class="h-2 w-2 rounded-full bg-destructive-foreground" aria-hidden="true"></span>
		Offline — will reconnect
	</div>
{/if}
