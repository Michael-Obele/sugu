<script lang="ts">
	import { cn } from '$lib/utils';
	import type { SessionMeta } from '$lib/api';

	type Props = {
		sessions: SessionMeta[];
		onSelect: (id: string) => void;
		onNew: () => void;
		activeId?: string | null;
	};

	let { sessions, onSelect, onNew, activeId = null }: Props = $props();

	function relativeTime(iso: string): string {
		try {
			const d = new Date(iso);
			const diff = Date.now() - d.getTime();
			const mins = Math.floor(diff / 60000);
			if (mins < 1) return 'just now';
			if (mins < 60) return `${mins}m ago`;
			const hrs = Math.floor(mins / 60);
			if (hrs < 24) return `${hrs}h ago`;
			const days = Math.floor(hrs / 24);
			if (days < 7) return `${days}d ago`;
			return d.toLocaleDateString();
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
				'min-h-[44px]',
				activeId === session.id && 'border-primary bg-accent'
			)}
		>
			<span class="text-sm font-medium">{session.title || 'Untitled'}</span>
			<span class="text-xs text-muted-foreground"
				>{relativeTime(session.updatedAt)} \u00b7 {session.model}</span
			>
		</button>
	{:else}
		<div class="rounded-xl border border-dashed p-8 text-center">
			<p class="text-sm font-medium">No sessions yet</p>
			<p class="mt-1 text-xs text-muted-foreground">Create one to start chatting</p>
		</div>
	{/each}
</div>
