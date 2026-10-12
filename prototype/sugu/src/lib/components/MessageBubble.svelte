<script lang="ts">
	import { cn } from '$lib/utils';

	type Props = {
		role: 'user' | 'assistant' | 'system';
		text: string;
		streaming?: boolean;
		interrupted?: boolean;
		onRerun?: () => void;
	};

	let { role, text, streaming = false, interrupted = false, onRerun }: Props = $props();

	let isUser = $derived(role === 'user');
	let announceText = $state('');
	let lastAnnounce = $state(0);

	// Throttle aria-live announcements to ~1s
	$effect(() => {
		// Access text to track it
		const currentText = text;
		if (!streaming) {
			announceText = currentText;
			return;
		}
		const now = Date.now();
		if (now - lastAnnounce > 1000) {
			announceText = currentText;
			lastAnnounce = now;
		}
	});
</script>

<div class={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
	<div
		class={cn(
			'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
			isUser ? 'bg-primary text-primary-foreground' : 'border bg-card text-foreground',
			interrupted && 'border-dashed border-amber-500/50',
			streaming && 'animate-pulse'
		)}
		aria-live={streaming ? 'polite' : undefined}
		aria-atomic="true"
	>
		{#if streaming}
			<span class="sr-only">{announceText}</span>
		{/if}
		<p class="break-words whitespace-pre-wrap">{text}</p>
		{#if interrupted}
			<div class="mt-2 flex items-center gap-2">
				<span class="text-xs text-amber-400">Interrupted</span>
				{#if onRerun}
					<button
						type="button"
						onclick={onRerun}
						class="min-h-[44px] min-w-[44px] rounded-md border border-amber-500/50 bg-amber-500/10 px-2 py-1 text-xs font-medium text-amber-200 hover:bg-amber-500/20 focus-visible:ring-2 focus-visible:ring-amber-500 focus-visible:outline-none"
					>
						Re-run
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>
