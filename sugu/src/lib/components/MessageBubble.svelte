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
	let pendingAnnounce: string | null = null;
	let announceTimer: ReturnType<typeof setTimeout> | null = null;

	function flushAnnounce(): void {
		if (pendingAnnounce !== null) {
			announceText = pendingAnnounce;
			pendingAnnounce = null;
			lastAnnounce = Date.now();
		}
		if (announceTimer !== null) {
			clearTimeout(announceTimer);
			announceTimer = null;
		}
	}

	function scheduleAnnounce(next: string): void {
		const now = Date.now();
		if (now - lastAnnounce >= 1000) {
			announceText = next;
			lastAnnounce = now;
			pendingAnnounce = null;
			if (announceTimer !== null) {
				clearTimeout(announceTimer);
				announceTimer = null;
			}
		} else {
			pendingAnnounce = next;
			if (announceTimer === null) {
				const delay = 1000 - (now - lastAnnounce);
				announceTimer = setTimeout(flushAnnounce, delay);
			}
		}
	}

	$effect(() => {
		const currentText = text;
		const isStreaming = streaming;
		if (!isStreaming) {
			flushAnnounce();
			if (currentText !== announceText) announceText = currentText;
			return;
		}
		scheduleAnnounce(currentText);
	});
</script>

<div class={cn('flex', isUser ? 'justify-end' : 'justify-start')}>
	<div
		class={cn(
			'max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-relaxed',
			isUser ? 'bg-primary text-primary-foreground' : 'border bg-card text-foreground',
			interrupted && 'border-dashed border-warning/50',
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
