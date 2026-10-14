<script lang="ts">
	/**
	 * Shared `command` shell used by both the `/` palette and the `#` skill picker.
	 * Filtering is the caller's job (`shouldFilter={false}`) so the registry or
	 * skill list is the single source of truth for what is listed.
	 */
	import * as Command from '$lib/components/ui/command/index.js';
	import { cn } from '$lib/utils';
	import type { Snippet } from 'svelte';

	type Props = {
		query?: string;
		placeholder?: string;
		emptyMessage?: string;
		class?: string;
		children: Snippet;
	};

	let {
		query = $bindable(''),
		placeholder = 'Search…',
		emptyMessage = 'No results.',
		class: className,
		children
	}: Props = $props();
</script>

<Command.Root shouldFilter={false} bind:value={query} class={cn('bg-transparent', className)}>
	<Command.Input {placeholder} />
	<Command.List>
		<Command.Empty>{emptyMessage}</Command.Empty>
		{@render children()}
	</Command.List>
</Command.Root>
