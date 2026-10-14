<script lang="ts">
	import type { SkillInfo } from '$lib/api';
	import * as Command from '$lib/components/ui/command/index.js';
	import CommandMenu from '$lib/components/CommandMenu.svelte';
	import HashIcon from '@lucide/svelte/icons/hash';

	type Props = {
		skills: SkillInfo[];
		configured: boolean;
		error?: string;
		open?: boolean;
		query?: string;
		onSelect?: (name: string) => void;
		onOpenChange?: (open: boolean) => void;
	};

	let {
		skills,
		configured,
		error,
		open = $bindable(false),
		query = $bindable(''),
		onSelect,
		onOpenChange
	}: Props = $props();

	let filtered = $derived.by(() => {
		const q = query.trim().toLowerCase();
		if (!q) return skills;
		return skills.filter(
			(s) => s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
		);
	});

	function handleSelect(name: string): void {
		open = false;
		query = '';
		onOpenChange?.(false);
		onSelect?.(name);
	}
</script>

{#if open}
	<div
		class="mx-3 mb-2 overflow-hidden rounded-lg border bg-popover shadow-md"
		role="listbox"
		aria-label="Skills"
	>
		{#if !configured}
			<div class="px-3 py-6 text-center text-sm text-muted-foreground">
				<HashIcon class="mx-auto mb-2 size-5 opacity-50" />
				<p>No skill sources configured</p>
				<p class="mt-1 text-xs">Set SUGU_SKILL_SOURCES to enable skills.</p>
			</div>
		{:else if error}
			<div class="px-3 py-4 text-center text-sm text-destructive">
				Failed to load skills: {error}
			</div>
		{:else}
			<CommandMenu bind:query placeholder="Search skills…" emptyMessage="No skill found.">
				{#snippet children()}
					<Command.Group>
						{#each filtered.slice(0, 50) as skill (skill.name)}
							<Command.Item
								value={skill.name}
								onSelect={() => handleSelect(skill.name)}
								class="flex min-h-[44px] items-center gap-2 py-2"
							>
								<HashIcon class="size-4 shrink-0 text-muted-foreground" />
								<span class="flex-1 truncate text-sm font-medium">{skill.name}</span>
								<span class="truncate text-xs text-muted-foreground">{skill.source}</span>
							</Command.Item>
						{/each}
					</Command.Group>
				{/snippet}
			</CommandMenu>
		{/if}
	</div>
{/if}
