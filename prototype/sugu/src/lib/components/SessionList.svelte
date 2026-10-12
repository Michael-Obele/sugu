<script lang="ts">
	import { cn } from '$lib/utils';
	import type { SessionMeta } from '$lib/api';

	type Props = {
		sessions: SessionMeta[];
		onSelect: (id: string) => void;
		onNew: () => void;
	};

	let { sessions, onSelect, onNew }: Props = $props();

	function formatTime(iso: string): string {
		try {
			const d = new Date(iso);
			return d.toLocaleString();
		} catch {
			return iso;
		}
	}
</script>

<div class="flex flex-col gap-2 p-4">
	<button
		type="button"
		onclick={onNew}
		class={cn(
			'flex min-h-[44px] items-center justify-center rounded-xl border border-dashed bg-card px-4 py-3 text-sm font-medium',
			'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
		)}
	>
		New session
	</button>

	{#each sessions as session (session.id)}
		<button
			type="button"
			onclick={() => onSelect(session.id)}
			class={cn(
				'flex flex-col items-start gap-1 rounded-xl border bg-card px-4 py-3 text-left',
				'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
				'min-h-[44px]'
			)}
		>
			<span class="text-sm font-medium">{session.title}</span>
			<span class="text-xs text-muted-foreground">{formatTime(session.updatedAt)}</span>
		</button>
	{:else}
		<p class="py-8 text-center text-sm text-muted-foreground">No sessions yet</p>
	{/each}
</div>
