<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getToken, logout } from '$lib/api';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';

	let model = $state('deepseek-chat');
	let quota: { day: string; turns: number; prompt_t: number; compl_t: number; cost_usd: number } | null = $state(null);
	let quotaError: string | null = $state(null);

	onMount(() => {
		try {
			const stored = localStorage.getItem('sugu_model');
			if (stored) model = stored;
		} catch {
			// ignore
		}
		try {
			const token = getToken();
			if (token) {
				fetch('/api/quota', { headers: { Authorization: `Bearer ${token}` } })
					.then((r) => (r.ok ? r.json() : null))
					.then((data) => {
						if (data) quota = data;
					})
					.catch(() => {
						quotaError = 'quota unavailable';
					});
		}
		} catch {
			// ignore
		}
	});

	function handleModelChange(): void {
		try {
			localStorage.setItem('sugu_model', model);
		} catch {
			// ignore
		}
	}

	function handleLogout(): void {
		logout();
		goto('/login');
	}
</script>

<div class="flex min-h-dvh flex-col bg-background">
	<header class="safe-top flex h-14 items-center gap-2 border-b px-4">
		<a
			href="/"
			class="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-2 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
			aria-label="Back"
		>
			\u2190
		</a>
		<h1 class="text-lg font-semibold">Settings</h1>
	</header>

	<main class="flex flex-1 flex-col gap-6 p-4">
		<div class="space-y-2">
			<label for="model" class="text-sm font-medium">Model default</label>
			<Input id="model" bind:value={model} placeholder="deepseek-chat" class="min-h-[44px]" />
			<Button variant="outline" onclick={handleModelChange} class="min-h-[44px]">Save</Button>
		</div>

		{#if quota}
			<div class="rounded-xl border p-4">
				<p class="text-sm font-medium">Quota \u2014 {quota.day}</p>
				<p class="text-sm text-muted-foreground">Turns: {quota.turns} \u00b7 Prompt: {quota.prompt_t} \u00b7 Completion: {quota.compl_t} \u00b7 Cost: ${quota.cost_usd.toFixed(4)}</p>
			</div>
		{:else if quotaError}
			<div class="rounded-xl border border-dashed p-4">
				<p class="text-sm text-muted-foreground">{quotaError}</p>
			</div>
		{:else}
			<div class="rounded-xl border border-dashed p-4">
				<p class="text-sm text-muted-foreground">Quota \u2014 loading\u2026</p>
			</div>
		{/if}

		<div class="mt-auto">
			<Button variant="destructive" onclick={handleLogout} class="min-h-[44px] w-full"
				>Logout</Button
			>
		</div>
	</main>
</div>
