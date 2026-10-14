<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getToken, setOnUnauthorized } from '$lib/api';
	import { viewport } from '$lib/viewport.svelte';
	import { sessionsStore } from '$lib/sessions.svelte';
	import SessionList from '$lib/components/SessionList.svelte';
	import ModelPicker from '$lib/components/ModelPicker.svelte';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import MessageSquareIcon from '@lucide/svelte/icons/message-square';

	let isDesktop = $derived(viewport.isDesktop);

	onMount(() => {
		const token = getToken();
		if (!token) {
			goto('/login');
			return;
		}
		setOnUnauthorized(() => goto('/login'));
		// sessionsStore is already loading via AppShell, but ensure
		if (sessionsStore.sessions.length === 0 && !sessionsStore.loading) {
			void sessionsStore.load();
			void sessionsStore.loadModels();
		}
	});

	async function handleCreate(): Promise<void> {
		const session = await sessionsStore.create();
		if (session) goto(`/s/${session.id}`);
	}

	function handleSelect(id: string): void {
		goto(`/s/${id}`);
	}

	function handleSheetOpenChange(open: boolean): void {
		sessionsStore.handleSheetOpenChange(open);
	}

	async function handleSessionsChanged(): Promise<void> {
		await sessionsStore.load();
	}
</script>

{#if isDesktop}
	<div class="flex flex-1 flex-col items-center justify-center gap-6 p-8">
		<div class="flex flex-col items-center gap-3 text-center">
			<div class="flex items-center gap-2">
				<MessageSquareIcon class="size-8 text-muted-foreground" />
				<h1 class="text-2xl font-semibold tracking-tight">Sugu</h1>
			</div>
			<p class="max-w-sm text-sm text-muted-foreground">
				Your conversations, one thread at a time — pick up where you left off or start something
				new.
			</p>
		</div>
		<Button onclick={() => (sessionsStore.sheetOpen = true)} class="min-h-11 gap-2">
			<PlusIcon class="size-4" />
			New session
		</Button>
		<p class="text-xs text-muted-foreground">
			History lives in the sidebar — open a session to continue.
		</p>
	</div>

	<Sheet.Root bind:open={sessionsStore.sheetOpen} onOpenChange={handleSheetOpenChange}>
		<Sheet.Content side="bottom" class="rounded-t-xl">
			<Sheet.Header>
				<Sheet.Title>New session</Sheet.Title>
				<Sheet.Description>Pick a model and start chatting.</Sheet.Description>
			</Sheet.Header>
			<div class="flex flex-col gap-4 p-4">
				<div class="flex flex-col gap-2">
					<Label for="new-title">Title (optional)</Label>
					<Input
						id="new-title"
						bind:value={sessionsStore.newTitle}
						placeholder="New session"
						maxlength={60}
						class="min-h-11"
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label>Model</Label>
					{#if sessionsStore.modelsLoading}
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Spinner class="size-4" />
							Loading models…
						</div>
					{:else}
						<ModelPicker
							models={sessionsStore.models}
							value={sessionsStore.newModel}
							source={sessionsStore.modelsSource}
							onSelect={(id) => (sessionsStore.newModel = id)}
						/>
					{/if}
				</div>
				<Button
					onclick={handleCreate}
					disabled={sessionsStore.creating}
					class="min-h-11 w-full gap-2"
				>
					{#if sessionsStore.creating}
						<Spinner class="size-4" />
						Creating…
					{:else}
						<PlusIcon class="size-4" />
						Create session
					{/if}
				</Button>
			</div>
		</Sheet.Content>
	</Sheet.Root>
{:else}
	<div class="flex min-h-dvh flex-col bg-background">
		<header class="safe-top flex h-14 items-center justify-between border-b px-4">
			<h1 class="text-lg font-semibold">Sugu</h1>
			<a
				href="/settings"
				class="flex min-h-11 min-w-11 items-center justify-center rounded-md px-3 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
				aria-label="Settings"
			>
				<SettingsIcon class="size-5" />
			</a>
		</header>

		<main class="flex-1">
			{#if sessionsStore.loading}
				<div class="flex flex-col items-center gap-3 py-12">
					<Spinner class="size-6" />
					<p class="text-sm text-muted-foreground">Loading sessions…</p>
				</div>
			{:else if sessionsStore.error && sessionsStore.sessions.length === 0}
				<div class="mx-4 mt-4 rounded-xl border border-destructive/50 bg-destructive/10 p-4">
					<p class="text-sm text-destructive">{sessionsStore.error}</p>
					<Button variant="outline" onclick={() => location.reload()} class="mt-2 min-h-11"
						>Retry</Button
					>
				</div>
			{:else}
				<div data-slot="session-list">
					<SessionList
						sessions={sessionsStore.sessions}
						onSelect={handleSelect}
						onNew={() => (sessionsStore.sheetOpen = true)}
						onChanged={handleSessionsChanged}
					/>
				</div>
			{/if}
		</main>

		<Sheet.Root bind:open={sessionsStore.sheetOpen} onOpenChange={handleSheetOpenChange}>
			<Sheet.Content side="bottom" class="rounded-t-xl">
				<Sheet.Header>
					<Sheet.Title>New session</Sheet.Title>
					<Sheet.Description>Pick a model and start chatting.</Sheet.Description>
				</Sheet.Header>
				<div class="flex flex-col gap-4 p-4">
					<div class="flex flex-col gap-2">
						<Label for="new-title-mobile">Title (optional)</Label>
						<Input
							id="new-title-mobile"
							bind:value={sessionsStore.newTitle}
							placeholder="New session"
							maxlength={60}
							class="min-h-11"
						/>
					</div>
					<div class="flex flex-col gap-2">
						<Label>Model</Label>
						{#if sessionsStore.modelsLoading}
							<div class="flex items-center gap-2 text-sm text-muted-foreground">
								<Spinner class="size-4" />
								Loading models…
							</div>
						{:else}
							<ModelPicker
								models={sessionsStore.models}
								value={sessionsStore.newModel}
								source={sessionsStore.modelsSource}
								onSelect={(id) => (sessionsStore.newModel = id)}
							/>
						{/if}
					</div>
					<Button
						onclick={handleCreate}
						disabled={sessionsStore.creating}
						class="min-h-11 w-full gap-2"
					>
						{#if sessionsStore.creating}
							<Spinner class="size-4" />
							Creating…
						{:else}
							<PlusIcon class="size-4" />
							Create session
						{/if}
					</Button>
				</div>
			</Sheet.Content>
		</Sheet.Root>
	</div>
{/if}
