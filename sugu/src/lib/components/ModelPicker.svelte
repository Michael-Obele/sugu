<script lang="ts">
	import { cn } from '$lib/utils';
	import { formatPrice, formatContextLength } from '$lib/format';
	import type { ModelInfo } from '$lib/api';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import * as Command from '$lib/components/ui/command/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';

	type Props = {
		models: ModelInfo[];
		value?: string;
		source?: string;
		placeholder?: string;
		disabled?: boolean;
		onSelect?: (id: string) => void;
	};

	let {
		models,
		value = '',
		source,
		placeholder = 'Select model',
		disabled = false,
		onSelect
	}: Props = $props();

	let open = $state(false);
	let search = $state('');

	let selected = $derived(models.find((m) => m.id === value) ?? null);

	let filtered = $derived.by(() => {
		if (!search.trim()) return models;
		const q = search.trim().toLowerCase();
		return models.filter(
			(m) => m.id.toLowerCase().includes(q) || m.label.toLowerCase().includes(q)
		);
	});

	function handleSelect(id: string): void {
		open = false;
		search = '';
		onSelect?.(id);
	}
</script>

<Popover.Root bind:open>
	<Popover.Trigger>
		{#snippet child({ props })}
			<Button
				{...props}
				variant="outline"
				role="combobox"
				aria-expanded={open}
				{disabled}
				class={cn(
					'w-full justify-between min-h-11 font-normal',
					!value && 'text-muted-foreground'
				)}
			>
				<span class="truncate text-left">
					{#if selected}
						{selected.label}
						<span class="text-xs text-muted-foreground"> · {selected.id}</span>
					{:else}
						{placeholder}
					{/if}
				</span>
				<ChevronsUpDownIcon class="ml-2 h-4 w-4 shrink-0 opacity-50" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-[min(22rem,calc(100vw-2rem))] p-0" align="start">
		<Command.Root>
			<Command.Input placeholder="Search models…" bind:value={search} />
			<Command.List>
				<Command.Empty>No model found.</Command.Empty>
				<Command.Group>
					{#each filtered.slice(0, 100) as model (model.id)}
						<Command.Item
							value={model.id}
							onSelect={() => handleSelect(model.id)}
							class="flex flex-col items-start gap-0.5 py-2 min-h-11"
						>
							<span class="flex w-full items-center gap-2">
								<CheckIcon
									class={cn('h-4 w-4 shrink-0', value === model.id ? 'opacity-100' : 'opacity-0')}
								/>
								<span class="truncate text-sm font-medium">{model.label}</span>
								<span class="ml-auto text-xs text-muted-foreground truncate">{model.id}</span>
							</span>
							<span class="ml-6 flex gap-3 text-xs text-muted-foreground">
								<span>{formatContextLength(model.contextLength)} ctx</span>
								<span>{formatPrice(model)}</span>
							</span>
						</Command.Item>
					{/each}
					{#if filtered.length > 100}
						<div class="px-2 py-1.5 text-xs text-muted-foreground text-center">
							Showing 100 of {filtered.length} — keep typing to narrow
						</div>
					{/if}
				</Command.Group>
			</Command.List>
			{#if source === 'fallback'}
				<div class="border-t px-3 py-2 text-xs text-muted-foreground">
					Offline catalogue — prices may be stale
				</div>
			{/if}
		</Command.Root>
	</Popover.Content>
</Popover.Root>
