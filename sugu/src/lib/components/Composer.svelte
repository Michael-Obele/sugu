<script lang="ts">
	import { cn } from '$lib/utils';
	import { Button } from '$lib/components/ui/button/index.js';
	import SendIcon from '@lucide/svelte/icons/send';
	import SquareIcon from '@lucide/svelte/icons/square';
	import SkillPicker from '$lib/components/SkillPicker.svelte';
	import SkillChips from '$lib/components/SkillChips.svelte';
	import CommandPalette from '$lib/components/CommandPalette.svelte';
	import { activeTrigger } from '$lib/composer-triggers';
	import { getCommand, commandInsertText, parseCommand } from '$lib/commands';
	import { detailLevelStore } from '$lib/detail-level.svelte';
	import { thinkingStore } from '$lib/thinking.svelte';
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
		onCommand?: (name: string, args: string) => void;
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
		onSkillsChange,
		onCommand
	}: Props = $props();

	let textareaEl: HTMLTextAreaElement | null = $state(null);
	let pickerOpen = $state(false);
	let pickerQuery = $state('');
	let hashTriggerPos: number | null = $state(null);

	let commandOpen = $state(false);
	let commandQuery = $state('');
	let slashTriggerPos: number | null = $state(null);

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
		const parsed = parseCommand(text);
		if (parsed && getCommand(parsed.name)) {
			const cmd = getCommand(parsed.name)!;
			if (!cmd.takesArg || parsed.args) {
				value = '';
				selectedSkills = [];
				onSkillsChange?.([]);
				commandOpen = false;
				pickerOpen = false;
				requestAnimationFrame(autogrow);
				onCommand?.(parsed.name, parsed.args);
				return;
			}
		}
		onSend(text, selectedSkills.length > 0 ? [...selectedSkills] : undefined);
		value = '';
		selectedSkills = [];
		onSkillsChange?.([]);
		pickerOpen = false;
		commandOpen = false;
		requestAnimationFrame(autogrow);
	}

	function handleKeydown(e: KeyboardEvent): void {
		if (e.key === 'Enter' && !e.shiftKey) {
			if (pickerOpen || commandOpen) {
				return;
			}
			e.preventDefault();
			const text = value.trim();
			if (!text || busy || disabled) return;
			const parsed = parseCommand(text);
			if (parsed && getCommand(parsed.name)) {
				const cmd = getCommand(parsed.name)!;
				if (!cmd.takesArg || parsed.args) {
					value = '';
					selectedSkills = [];
					onSkillsChange?.([]);
					requestAnimationFrame(autogrow);
					onCommand?.(parsed.name, parsed.args);
					return;
				}
			}
			onSend(text, selectedSkills.length > 0 ? [...selectedSkills] : undefined);
			value = '';
			selectedSkills = [];
			onSkillsChange?.([]);
			pickerOpen = false;
			commandOpen = false;
			requestAnimationFrame(autogrow);
		}
		if (e.key === 'Escape') {
			if (commandOpen) {
				commandOpen = false;
				slashTriggerPos = null;
				e.preventDefault();
				return;
			}
			if (pickerOpen) {
				pickerOpen = false;
				pickerQuery = '';
				hashTriggerPos = null;
				e.preventDefault();
			}
		}
	}

	function handleInput(): void {
		autogrow();
		if (!textareaEl) return;
		const pos = textareaEl.selectionStart ?? value.length;
		const slashState = activeTrigger(value, pos, '/');
		const hashState = activeTrigger(value, pos, '#');

		if (slashState.open && slashState.index === 0) {
			commandQuery = slashState.query;
			slashTriggerPos = slashState.index;
			commandOpen = true;
			pickerOpen = false;
			pickerQuery = '';
			hashTriggerPos = null;
			return;
		}
		if (hashState.open) {
			pickerQuery = hashState.query;
			hashTriggerPos = hashState.index;
			pickerOpen = true;
			commandOpen = false;
			slashTriggerPos = null;
			return;
		}
		if (commandOpen) {
			commandOpen = false;
			commandQuery = '';
			slashTriggerPos = null;
		}
		if (pickerOpen) {
			pickerOpen = false;
			pickerQuery = '';
			hashTriggerPos = null;
		}
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
		if (hashTriggerPos !== null && textareaEl) {
			const before = value.slice(0, hashTriggerPos);
			const pos = textareaEl.selectionStart ?? value.length;
			const after = value.slice(pos);
			value = before + after;
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

	function handleCommandSelect(name: string): void {
		const cmd = getCommand(name);
		if (!cmd) return;
		if (cmd.takesArg) {
			const insert = commandInsertText(cmd);
			if (slashTriggerPos !== null && textareaEl) {
				const before = value.slice(0, slashTriggerPos);
				const pos = textareaEl.selectionStart ?? value.length;
				const after = value.slice(pos);
				value = before + insert + after;
				requestAnimationFrame(() => {
					if (!textareaEl) return;
					const newPos = (slashTriggerPos ?? 0) + insert.length;
					textareaEl.selectionStart = textareaEl.selectionEnd = newPos;
					autogrow();
					textareaEl.focus();
				});
			} else {
				value = insert;
				requestAnimationFrame(() => {
					if (!textareaEl) return;
					textareaEl.selectionStart = textareaEl.selectionEnd = insert.length;
					autogrow();
					textareaEl.focus();
				});
			}
			commandOpen = false;
			commandQuery = '';
			slashTriggerPos = null;
		} else {
			if (slashTriggerPos !== null && textareaEl) {
				const pos = textareaEl.selectionStart ?? value.length;
				const before = value.slice(0, slashTriggerPos);
				const after = value.slice(pos);
				value = before + after;
				requestAnimationFrame(() => {
					if (!textareaEl) return;
					textareaEl.selectionStart = textareaEl.selectionEnd = slashTriggerPos ?? 0;
					autogrow();
				});
			} else {
				value = '';
			}
			commandOpen = false;
			commandQuery = '';
			slashTriggerPos = null;
			onCommand?.(name, '');
		}
	}

	function handleCommandOpenChange(open: boolean): void {
		commandOpen = open;
		if (!open) {
			commandQuery = '';
			slashTriggerPos = null;
		}
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
	<CommandPalette
		bind:open={commandOpen}
		bind:query={commandQuery}
		detailLevel={detailLevelStore.level}
		thinkingMode={thinkingStore.mode}
		onSelect={handleCommandSelect}
		onOpenChange={handleCommandOpenChange}
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
				'max-h-32 min-h-11 flex-1 resize-none rounded-xl border bg-card px-4 py-3 text-sm leading-6',
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
				class="min-h-11 min-w-11"
				aria-label="Stop generating"
			>
				<SquareIcon class="size-4" />
				Stop
			</Button>
		{:else}
			<Button
				type="submit"
				disabled={!value.trim() || disabled}
				class="min-h-11 min-w-11"
				aria-label="Send message"
			>
				<SendIcon class="size-4" />
				Send
			</Button>
		{/if}
	</form>
</div>
