<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import XIcon from '@lucide/svelte/icons/x';
	import HashIcon from '@lucide/svelte/icons/hash';

	type Props = {
		skills: string[];
		onRemove?: (name: string) => void;
	};

	let { skills, onRemove }: Props = $props();
</script>

{#if skills.length > 0}
	<div class="flex flex-wrap gap-1.5 px-3 py-2" aria-label="Selected skills">
		{#each skills as name (name)}
			<Badge variant="secondary" class="gap-1 pr-1 text-xs font-normal">
				<HashIcon class="size-3" />
				{name}
				<button
					type="button"
					onclick={() => onRemove?.(name)}
					class="ml-1 inline-flex min-h-5 min-w-5 items-center justify-center rounded-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					aria-label="Remove {name}"
				>
					<XIcon class="size-3" />
				</button>
			</Badge>
		{/each}
	</div>
{/if}
