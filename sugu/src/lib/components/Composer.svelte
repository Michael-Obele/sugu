<script lang="ts">
	import { cn } from '$lib/utils';
	import { Button } from '$lib/components/ui/button/index.js';
	import SendIcon from '@lucide/svelte/icons/send';
	import SquareIcon from '@lucide/svelte/icons/square';

	type Props = {
		value?: string;
		busy?: boolean;
		disabled?: boolean;
		onSend: (text: string) => void;
		onCancel?: () => void;
	};

	let { value = $bindable(''), busy = false, disabled = false, onSend, onCancel }: Props = $props();

	let textareaEl: HTMLTextAreaElement | null = $state(null);

	function autogrow(): void {
		if (!textareaEl) return;
		textareaEl.style.height = 'auto';
		const max = 128;
		textareaEl.style.height = Math.min(textareaEl.scrollHeight, max) + 'px';
		textareaEl.style.overflowY = textareaEl.scrollHeight > max ? 'auto' : 'hidden';
	}

	function handleSubmit(e: SubmitEvent): void {
		e.preventDefault();
		const text = value.trim();
		if (!text || busy || disabled) return;
		onSend(text);
		value = '';
		requestAnimationFrame(autogrow);
	}

	function handleKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			const text = value.trim();
			if (!text || busy || disabled) return;
			onSend(text);
			value = '';
			requestAnimationFrame(autogrow);
		}
	}

	function handleInput(): void {
		autogrow();
	}
</script>

<form
	onsubmit={handleSubmit}
	class={cn(
		'flex items-end gap-2 border-t bg-background p-3',
		'pb-[max(0.75rem,env(safe-area-inset-bottom))]',
		'sticky bottom-0'
	)}
>
	<textarea
		bind:this={textareaEl}
		bind:value
		onkeydown={handleKeydown}
		oninput={handleInput}
		placeholder={busy ? 'Waiting for response…' : 'Message…'}
		disabled={busy || disabled}
		rows={1}
		class={cn(
			'max-h-32 min-h-[44px] flex-1 resize-none rounded-xl border bg-card px-4 py-3 text-sm leading-6',
			'placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
			'disabled:opacity-50'
		)}
		aria-label="Message"></textarea>
	{#if busy}
		<Button
			type="button"
			variant="outline"
			size="default"
			onclick={() => onCancel?.()}
			class="min-h-[44px] min-w-[44px]"
			aria-label="Stop generating"
		>
			<SquareIcon class="size-4" />
			Stop
		</Button>
	{:else}
		<Button
			type="submit"
			disabled={!value.trim() || disabled}
			class="min-h-[44px] min-w-[44px]"
			aria-label="Send message"
		>
			<SendIcon class="size-4" />
			Send
		</Button>
	{/if}
</form>
