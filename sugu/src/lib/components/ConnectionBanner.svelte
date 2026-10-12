<script lang="ts">
	import { cn } from '$lib/utils';

	type Props = {
		state: 'connecting' | 'open' | 'reconnecting' | 'closed';
	};

	let { state }: Props = $props();

	let visible = $derived(state === 'reconnecting' || state === 'connecting');
	let label = $derived(state === 'reconnecting' ? 'Reconnecting…' : 'Connecting…');
</script>

{#if visible}
	<div
		role="status"
		aria-live="polite"
		class={cn(
			'flex h-8 items-center justify-center bg-amber-500 px-4 text-sm font-medium text-black',
			'safe-top'
		)}
	>
		{label}
	</div>
{/if}
