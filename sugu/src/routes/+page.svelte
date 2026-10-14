<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { getToken, listSessions, createSession, getModels, setOnUnauthorized } from '$lib/api';
	import type { SessionMeta, ModelInfo } from '$lib/api';
	import SessionList from '$lib/components/SessionList.svelte';
	import ModelPicker from '$lib/components/ModelPicker.svelte';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import SettingsIcon from '@lucide/svelte/icons/settings';

	let sessions = $state<SessionMeta[]>([]);
	let loading = $state(true);
	let error = $state<string | null>(null);
	let creating = $state(false);

	let sheetOpen = $state(false);
	let newTitle = $state('');
	let newModel = $state('deepseek-chat');
	let models = $state<ModelInfo[]>([]);
	let modelsSource = $state<string>('fallback');
	let modelsLoading = $state(false);

	async function loadSessions(): Promise<void> {
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
	}

	async function loadModels(): Promise<void> {
		modelsLoading = true;
		try {
			const res = await getModels();
			models = res.models;
			modelsSource = res.source;
			// Default is the operator's SUGU_DEFAULT_MODEL (via API), else deepseek-chat.
			// Never blindly use models[0] — it is ~9x the intended price and unstable.
			// If the configured default is not in the catalogue, still use it (operator asked for it).
			if (res.defaultModel) {
				newModel = res.defaultModel;
			}
		} catch {
			// keep fallback
		} finally {
			modelsLoading = false;
		}
	}

	onMount(async () => {
		const token = getToken();
		if (!token) {
			goto('/login');
			return;
		}
		setOnUnauthorized(() => goto('/login'));
		await loadSessions();
		await loadModels();
	});

	async function handleCreate(): Promise<void> {
		if (creating) return;
		creating = true;
		error = null;
		try {
			const title = newTitle.trim() || undefined;
			const session = await createSession(title, newModel);
			sheetOpen = false;
			newTitle = '';
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

	function handleSheetOpenChange(open: boolean): void {
		sheetOpen = open;
		if (open) loadModels();
	}
</script>

<div class="flex min-h-dvh flex-col bg-background">
	<header class="safe-top flex h-14 items-center justify-between border-b px-4">
		<h1 class="text-lg font-semibold">Sugu</h1>
		<a
			href="/settings"
			class="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-3 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
			aria-label="Settings"
		>
			<SettingsIcon class="size-5" />
		</a>
	</header>

	<main class="flex-1">
		{#if loading}
			<div class="flex flex-col items-center gap-3 py-12">
				<Spinner class="size-6" />
				<p class="text-sm text-muted-foreground">Loading sessions…</p>
			</div>
		{:else if error && sessions.length === 0}
			<div class="mx-4 mt-4 rounded-xl border border-destructive/50 bg-destructive/10 p-4">
				<p class="text-sm text-destructive">{error}</p>
				<Button variant="outline" onclick={() => location.reload()} class="mt-2 min-h-[44px]"
					>Retry</Button
				>
			</div>
		{:else}
			<SessionList
				{sessions}
				onSelect={handleSelect}
				onNew={() => (sheetOpen = true)}
				onChanged={loadSessions}
			/>
		{/if}
	</main>

	<Sheet.Root bind:open={sheetOpen} onOpenChange={handleSheetOpenChange}>
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
						bind:value={newTitle}
						placeholder="New session"
						maxlength={60}
						class="min-h-[44px]"
					/>
				</div>
				<div class="flex flex-col gap-2">
					<Label>Model</Label>
					{#if modelsLoading}
						<div class="flex items-center gap-2 text-sm text-muted-foreground">
							<Spinner class="size-4" />
							Loading models…
						</div>
					{:else}
						<ModelPicker
							{models}
							value={newModel}
							source={modelsSource}
							onSelect={(id) => (newModel = id)}
						/>
					{/if}
				</div>
				<Button onclick={handleCreate} disabled={creating} class="min-h-[44px] w-full gap-2">
					{#if creating}
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
