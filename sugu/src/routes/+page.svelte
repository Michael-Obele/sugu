<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getToken, listSessions, createSession, setOnUnauthorized } from '$lib/api';
	import type { SessionMeta } from '$lib/api';
	import SessionList from '$lib/components/SessionList.svelte';

	let sessions = $state<SessionMeta[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let creating = $state(false);

	onMount(async () => {
		const token = getToken();
		if (!token) {
			goto('/login');
			return;
		}
		setOnUnauthorized(() => goto('/login'));
		try {
			sessions = await listSessions();
			sessions.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
		} catch (e) {
			const err = e as { status?: number; message?: string };
			if (err.status === 401) {
				goto('/login');
				return;
			}
			error = err.message ?? 'Failed to load sessions';
		} finally {
			loading = false;
		}
	});

	async function handleNew(): Promise<void> {
		if (creating) return;
		creating = true;
		try {
			const session = await createSession();
			goto(`/s/${session.id}`);
		} catch (e) {
			const err = e as { message?: string };
			error = err.message ?? 'Failed to create session';
		} finally {
			creating = false;
		}
	}

	function handleSelect(id: string): void {
		goto(`/s/${id}`);
	}
</script>

<div class="flex min-h-dvh flex-col bg-background">
	<header class="safe-top flex h-14 items-center justify-between border-b px-4">
		<h1 class="text-lg font-semibold">Sugu</h1>
		<a
			href="/settings"
			class="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-3 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
		>
			Settings
		</a>
	</header>

	<main class="flex-1">
		{#if loading}
			<div class="flex flex-col items-center gap-3 py-12">
				<div
					class="h-6 w-6 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent"
					aria-hidden="true"
				></div>
				<p class="text-sm text-muted-foreground">Loading sessions\u2026</p>
			</div>
		{:else if error}
			<div class="mx-4 mt-4 rounded-xl border border-destructive/50 bg-destructive/10 p-4">
				<p class="text-sm text-destructive">{error}</p>
				<button
					type="button"
					onclick={() => location.reload()}
					class="mt-2 min-h-[44px] rounded-md border bg-card px-3 py-1 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					>Retry</button
				>
			</div>
		{:else}
			<SessionList {sessions} onSelect={handleSelect} onNew={handleNew} />
		{/if}
	</main>
</div>
