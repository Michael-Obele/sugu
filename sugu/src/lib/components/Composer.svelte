<script lang="ts">
	import { cn } from '$lib/utils';
	import { Button } from '$lib/components/ui/button/index.js';
	import SendIcon from '@lucide/svelte/icons/send';
	import SquareIcon from '@lucide/svelte/icons/square';
	import SkillPicker from '$lib/components/SkillPicker.svelte';
	import SkillChips from '$lib/components/SkillChips.svelte';
	import type { SkillInfo } from '$lib/api';

	type Props = {
		value?: string;
		busy?: boolean;
		disabled?: boolean;
		skills?: SkillInfo[];
		skillsConfigured?: boolean;
		skillsError?: string;
		selectedSkills?: string[];
		onSend: (text: string, skills?: string[]) => void;
		onCancel?: () => void;
		onSkillsChange?: (skills: string[]) => void;
	};

	let {
		value = $bindable(''),
		busy = false,
		disabled = false,
		skills = [],
		skillsConfigured = true,
		skillsError,
		selectedSkills = $bindable([]),
		onSend,
		onCancel,
		onSkillsChange
	}: Props = $props();

	let textareaEl: HTMLTextAreaElement | null = $state(null);
	let pickerOpen = $state(false);
	let pickerQuery = $state('');
	let hashTriggerPos: number | null = $state(null);

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
		onSend(text, selectedSkills.length > 0 ? [...selectedSkills] : undefined);
		value = '';
		selectedSkills = [];
		onSkillsChange?.([]);
		pickerOpen = false;
		requestAnimationFrame(autogrow);
	}

	function handleKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter' && !e.shiftKey) {
			if (pickerOpen) {
				// Let picker handle Enter
				return;
			}
			e.preventDefault();
			const text = value.trim();
			if (!text || busy || disabled) return;
			onSend(text, selectedSkills.length > 0 ? [...selectedSkills] : undefined);
			value = '';
			selectedSkills = [];
			onSkillsChange?.([]);
			pickerOpen = false;
			requestAnimationFrame(autogrow);
		}
		if (e.key === 'Escape' && pickerOpen) {
			pickerOpen = false;
			pickerQuery = '';
			hashTriggerPos = null;
		}
	}

	function handleInput(): void {
		autogrow();
		if (!textareaEl) return;
		const pos = textareaEl.selectionStart ?? value.length;
		const before = value.slice(0, pos);
		const hashIdx = before.lastIndexOf('#');
		if (hashIdx === -1) {
			if (pickerOpen) {
				pickerOpen = false;
				pickerQuery = '';
				hashTriggerPos = null;
			}
			return;
		}
		// Check that # is at start or preceded by whitespace
		if (hashIdx > 0 && !/\s/.test(before[hashIdx - 1]!)) {
			if (pickerOpen) {
				pickerOpen = false;
				pickerQuery = '';
				hashTriggerPos = null;
			}
			return;
		}
		const afterHash = before.slice(hashIdx + 1);
		// If contains space, the # token is complete — close picker
		if (/\s/.test(afterHash)) {
			if (pickerOpen) {
				pickerOpen = false;
				pickerQuery = '';
				hashTriggerPos = null;
			}
			return;
		}
		pickerQuery = afterHash;
		hashTriggerPos = hashIdx;
		pickerOpen = true;
	}

	function handleSkillSelect(name: string): void {
		if (selectedSkills.includes(name)) {
			pickerOpen = false;
			pickerQuery = '';
			return;
		}
		const next = [...selectedSkills, name];
		selectedSkills = next;
		onSkillsChange?.(next);
		// Remove the #query from the textarea
		if (hashTriggerPos !== null && textareaEl) {
			const before = value.slice(0, hashTriggerPos);
			const pos = textareaEl.selectionStart ?? value.length;
			const after = value.slice(pos);
			value = before + after;
			// Move cursor to where # was
			requestAnimationFrame(() => {
				if (!textareaEl) return;
				textareaEl.selectionStart = textareaEl.selectionEnd = hashTriggerPos ?? 0;
				autogrow();
			});
		}
		pickerOpen = false;
		pickerQuery = '';
		hashTriggerPos = null;
		textareaEl?.focus();
	}

	function handleRemoveSkill(name: string): void {
		const next = selectedSkills.filter((s) => s !== name);
		selectedSkills = next;
		onSkillsChange?.(next);
	}
</script>

<div class="border-t bg-background sticky bottom-0 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
	<SkillChips skills={selectedSkills} onRemove={handleRemoveSkill} />
	<SkillPicker
		{skills}
		configured={skillsConfigured}
		error={skillsError}
		bind:open={pickerOpen}
		bind:query={pickerQuery}
		onSelect={handleSkillSelect}
	/>
	<form onsubmit={handleSubmit} class={cn('flex items-end gap-2 p-3 pt-2')}>
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
</div>
