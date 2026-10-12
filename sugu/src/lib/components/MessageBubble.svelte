<script lang="ts">
	import { cn } from '$lib/utils';
	import { createAnnouncer } from '$lib/announce';

	type Props = {
		role: 'user' | 'assistant' | 'system';
		text: string;
		streaming?: boolean;
		interrupted?: boolean;
		onRerun?: () => void;
	};

	let { role, text, streaming = false, interrupted = false, onRerun }: Props = $props();

	let isUser = $derived(role === 'user');

	// Throttled aria-live: announce at most once per second, trailing flush ensures
	// final content is always announced. Pure helper owns the timer.
	// Driven via a render-time function (no $effect for state sync).
	const announcer = createAnnouncer(1000);
	let announceText = $state('');
	let prevText = $state('');
	let prevStreaming = $state<boolean | undefined>(undefined);

	function updateAnnounce(currentText: string, isStreaming: boolean): string {
		if (currentText === prevText && isStreaming === prevStreaming) return announceText;
		prevText = currentText;
		prevStreaming = isStreaming;
		if (!isStreaming) {
			announcer.flush();
			announceText = currentText;
		} else {
			announceText = announcer.throttled(currentText);
		}
		return announceText;
	}
</script>

<div class={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
	<div
		class={cn(
			'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
			isUser ? 'bg-primary text-primary-foreground' : 'border bg-card text-foreground',
			interrupted && 'border-dashed border-warning/50',
			streaming && 'streaming'
		)}
	>
		<span class="sr-only" aria-live="polite" aria-atomic="true">{updateAnnounce(text, streaming)}</span>
		<p class="break-words whitespace-pre-wrap">{text}</p>
		{#if interrupted}
			<div class="mt-2 flex items-center gap-2">
				<span class="text-xs text-warning">Interrupted</span>
				{#if onRerun}
					<button
						type="button"
						onclick={onRerun}
						class="min-h-[44px] min-w-[44px] rounded-md border border-warning/50 bg-warning/10 px-2 py-1 text-xs font-medium text-warning-foreground hover:bg-warning/20 focus-visible:ring-2 focus-visible:ring-warning focus-visible:outline-none"
					>
						Re-run
					</button>
				{/if}
			</div>
		{/if}
	</div>
</div>
