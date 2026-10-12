<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getToken, logout } from '$lib/api';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';

	let model = $state('deepseek-chat');

	onMount(() => {
		try {
			const stored = localStorage.getItem('sugu_model');
			if (stored) model = stored;
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
			←
		</a>
		<h1 class="text-lg font-semibold">Settings</h1>
	</header>

	<main class="flex flex-1 flex-col gap-6 p-4">
		<div class="space-y-2">
			<label for="model" class="text-sm font-medium">Model default</label>
			<Input id="model" bind:value={model} placeholder="deepseek-chat" class="min-h-[44px]" />
			<Button variant="outline" onclick={handleModelChange} class="min-h-[44px]">Save</Button>
		</div>

		<!-- Quota strip placeholder (Phase 2) -->
		<div class="rounded-xl border border-dashed p-4">
			<p class="text-sm text-muted-foreground">Quota — coming soon</p>
		</div>

		<div class="mt-auto">
			<Button variant="destructive" onclick={handleLogout} class="min-h-[44px] w-full"
				>Logout</Button
			>
		</div>
	</main>
</div>
