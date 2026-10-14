<script lang="ts">
	import { cn } from '$lib/utils';
	import { formatPrice, formatContextLength } from '$lib/format';
	import type { ModelInfo } from '$lib/api';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import * as Command from '$lib/components/ui/command/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';

	type Props = {
		models: ModelInfo[];
		value?: string;
		defaultModel?: string;
		source?: string;
		placeholder?: string;
		disabled?: boolean;
		onSelect?: (id: string) => void;
	};

	let {
		models,
		value = '',
		defaultModel = 'deepseek-chat',
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
			(m) =>
				m.id.toLowerCase().includes(q) ||
				m.label.toLowerCase().includes(q) ||
				m.provider.toLowerCase().includes(q)
		);
	});

	let directFiltered = $derived(filtered.filter((m) => m.provider === 'deepseek'));
	let openRouterFiltered = $derived(filtered.filter((m) => m.provider === 'openrouter'));

	// Per-group cap: 50 each, with counts
	const PER_GROUP_CAP = 50;

	let directShown = $derived(directFiltered.slice(0, PER_GROUP_CAP));
	let openRouterShown = $derived(openRouterFiltered.slice(0, PER_GROUP_CAP));

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
					'h-11 min-h-11 w-full justify-between rounded-md border !bg-card px-3 py-2 text-sm font-normal dark:!bg-card',
					!value && !selected && 'text-muted-foreground'
				)}
			>
				<span class="truncate text-left">
					{#if selected}
						{selected.label}
						<span class="text-xs text-muted-foreground"> · {selected.id}</span>
						{#if selected.id === defaultModel}
							<span class="ml-1 text-xs text-muted-foreground">(default)</span>
						{/if}
					{:else if value}
						<span>{value}</span>
						<span class="ml-1 text-xs text-muted-foreground">· not in catalogue</span>
					{:else}
						{placeholder}
					{/if}
				</span>
				<ChevronDownIcon class="ml-2 size-4 shrink-0 text-muted-foreground opacity-50" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content class="w-[min(22rem,calc(100vw-2rem))] p-0" align="start">
		<Command.Root>
			<Command.Input placeholder="Search models…" bind:value={search} />
			<Command.List>
				<Command.Empty>No model found.</Command.Empty>
				{#if directShown.length > 0}
					<Command.Group heading="Direct (DeepSeek)">
						{#each directShown as model (model.id)}
							<Command.Item
								value={model.id}
								onSelect={() => handleSelect(model.id)}
								class="flex min-h-11 flex-col items-start gap-0.5 py-2"
							>
								<span class="flex w-full items-center gap-2">
									<CheckIcon
										class={cn('h-4 w-4 shrink-0', value === model.id ? 'opacity-100' : 'opacity-0')}
									/>
									<span class="truncate text-sm font-medium"
										>{model.label}{#if model.id === defaultModel}<span
												class="ml-1 text-xs text-muted-foreground">· default</span
											>{/if}</span
									>
									<span class="ml-auto truncate text-xs text-muted-foreground">{model.id}</span>
								</span>
								<span class="ml-6 flex gap-3 text-xs text-muted-foreground">
									<span>{formatContextLength(model.contextLength)} ctx</span>
									<span>{formatPrice(model)}</span>
								</span>
							</Command.Item>
						{/each}
						{#if directFiltered.length > PER_GROUP_CAP}
							<div class="px-2 py-1.5 text-center text-xs text-muted-foreground">
								Showing {PER_GROUP_CAP} of {directFiltered.length} — keep typing to narrow
							</div>
						{/if}
					</Command.Group>
				{/if}
				{#if openRouterShown.length > 0}
					<Command.Group heading="OpenRouter">
						{#each openRouterShown as model (model.id)}
							<Command.Item
								value={model.id}
								onSelect={() => handleSelect(model.id)}
								class="flex min-h-11 flex-col items-start gap-0.5 py-2"
							>
								<span class="flex w-full items-center gap-2">
									<CheckIcon
										class={cn('h-4 w-4 shrink-0', value === model.id ? 'opacity-100' : 'opacity-0')}
									/>
									<span class="truncate text-sm font-medium"
										>{model.label}{#if model.id === defaultModel}<span
												class="ml-1 text-xs text-muted-foreground">· default</span
											>{/if}</span
									>
									<span class="ml-auto truncate text-xs text-muted-foreground">{model.id}</span>
								</span>
								<span class="ml-6 flex gap-3 text-xs text-muted-foreground">
									<span>{formatContextLength(model.contextLength)} ctx</span>
									<span>{formatPrice(model)}</span>
								</span>
							</Command.Item>
						{/each}
						{#if openRouterFiltered.length > PER_GROUP_CAP}
							<div class="px-2 py-1.5 text-center text-xs text-muted-foreground">
								Showing {PER_GROUP_CAP} of {openRouterFiltered.length} — keep typing to narrow
							</div>
						{/if}
					</Command.Group>
				{/if}
			</Command.List>
			{#if source === 'fallback'}
				<div class="border-t px-3 py-2 text-xs text-muted-foreground">
					Offline catalogue — prices may be stale
				</div>
			{/if}
		</Command.Root>
	</Popover.Content>
</Popover.Root>
