<script lang="ts">
	/**
	 * The `/` palette. Renders the shared `CommandMenu` shell inside a Dialog so
	 * focus is trapped and restored by the primitive, and lists the command
	 * registry — the same list `/help` renders.
	 */
	import * as Command from '$lib/components/ui/command/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import CommandMenu from '$lib/components/CommandMenu.svelte';
	import { filterCommands, type CommandDef } from '$lib/commands';
	import { detailLevelHint, type DetailLevel } from '$lib/detail-level';
	import { thinkingModeHint, type ThinkingMode } from '$lib/thinking';
	import SlashIcon from '@lucide/svelte/icons/slash';

	type Props = {
		open?: boolean;
		query?: string;
		detailLevel?: DetailLevel;
		thinkingMode?: ThinkingMode;
		onSelect?: (name: string) => void;
		onOpenChange?: (open: boolean) => void;
	};

	let {
		open = $bindable(false),
		query = $bindable(''),
		detailLevel = 'compact',
		thinkingMode = 'show',
		onSelect,
		onOpenChange
	}: Props = $props();

	let filtered = $derived(filterCommands(query));

	function describe(cmd: CommandDef): string {
		if (cmd.name === 'details') return detailLevelHint(detailLevel);
		if (cmd.name === 'thinking') return thinkingModeHint(thinkingMode);
		return cmd.description;
	}

	function handleSelect(name: string): void {
		query = '';
		open = false;
		onOpenChange?.(false);
		onSelect?.(name);
	}

	function handleOpenChange(next: boolean): void {
		if (!next) query = '';
		onOpenChange?.(next);
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Header class="sr-only">
		<Dialog.Title>Commands</Dialog.Title>
		<Dialog.Description>Search and run a Sugu command.</Dialog.Description>
	</Dialog.Header>
	<Dialog.Content
		class="top-1/3 translate-y-0 gap-0 overflow-hidden p-0 pb-[env(safe-area-inset-bottom)]"
		showCloseButton={false}
	>
		<CommandMenu bind:query placeholder="Type a command…" emptyMessage="No command found.">
			{#snippet children()}
				<Command.Group>
					{#each filtered as cmd (cmd.name)}
						<Command.Item
							value={cmd.name}
							keywords={[cmd.name, cmd.description]}
							onSelect={() => handleSelect(cmd.name)}
							class="min-h-11 gap-2"
						>
							<SlashIcon class="size-4 shrink-0 text-muted-foreground" />
							<span class="truncate text-sm font-medium">/{cmd.name}</span>
							<span class="truncate text-xs text-muted-foreground">{describe(cmd)}</span>
						</Command.Item>
					{/each}
				</Command.Group>
			{/snippet}
		</CommandMenu>
		<div class="flex gap-3 border-t px-3 py-2 text-xs text-muted-foreground" aria-hidden="true">
			<span><kbd class="rounded border bg-muted px-1 py-0.5 text-xs">↑↓</kbd> move</span>
			<span><kbd class="rounded border bg-muted px-1 py-0.5 text-xs">↵</kbd> run</span>
			<span><kbd class="rounded border bg-muted px-1 py-0.5 text-xs">Esc</kbd> close</span>
		</div>
	</Dialog.Content>
</Dialog.Root>
