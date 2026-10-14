<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { viewport, sidebarState } from '$lib/viewport.svelte';
	import { sessionsStore } from '$lib/sessions.svelte';
	import { getToken, setOnUnauthorized } from '$lib/api';
	import { sessionStore } from '$lib/session.svelte';
	import SessionList from '$lib/components/SessionList.svelte';
	import * as Sheet from '$lib/components/ui/sheet/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import PanelLeftCloseIcon from '@lucide/svelte/icons/panel-left-close';
	import SettingsIcon from '@lucide/svelte/icons/settings';
	import type { Snippet } from 'svelte';

	let { children }: { children: Snippet } = $props();

	onMount(() => {
		const token = getToken();
		if (token) {
			setOnUnauthorized(() => goto('/login'));
			void sessionsStore.load();
			void sessionsStore.loadModels();
		}
	});

	function toggleCollapse(): void {
		sidebarState.toggle();
	}

	function handleSelect(id: string): void {
		sessionsStore.historySheetOpen = false;
		goto(`/s/${id}`);
	}

	function handleNew(): void {
		sessionsStore.historySheetOpen = false;
		sessionsStore.sheetOpen = true;
	}

	async function handleSessionsChanged(): Promise<void> {
		const currentId = page.params['id'] as string | undefined;
		if (!(await sessionsStore.load())) return;
		if (currentId && !sessionsStore.sessions.some((s) => s.id === currentId)) {
			sessionStore.disconnect();
			goto('/');
		}
	}

	function handleHistoryOpenChange(open: boolean): void {
		sessionsStore.historySheetOpen = open;
	}

	let isDesktop = $derived(viewport.isDesktop);
	let showSidebar = $derived(isDesktop && !sidebarState.collapsed);
</script>

<div class="flex h-dvh bg-background">
	{#if showSidebar}
		<aside
			class="flex h-dvh w-72 shrink-0 flex-col border-r border-border bg-card/40 motion-safe:transition-[width] motion-safe:duration-200 lg:w-80"
		>
			<div class="flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
				<a
					href="/"
					class="text-lg font-semibold tracking-tight focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
					>Sugu</a
				>
				<div class="flex items-center gap-1">
					<button
						type="button"
						onclick={toggleCollapse}
						class="flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
						aria-label="Collapse sidebar"
					>
						<PanelLeftCloseIcon class="size-4" />
					</button>
					<a
						href="/settings"
						class="flex min-h-11 min-w-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
						aria-label="Settings"
					>
						<SettingsIcon class="size-4" />
					</a>
				</div>
			</div>
			<div class="min-h-0 flex-1 overflow-y-auto" data-slot="session-list">
				{#if sessionsStore.error}
					<div
						role="alert"
						class="m-3 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
					>
						{sessionsStore.error}
						<button
							type="button"
							onclick={() => sessionsStore.load()}
							class="mt-2 block min-h-11 underline">Retry</button
						>
					</div>
				{:else if sessionsStore.loading}
					<div
						class="flex flex-1 items-center justify-center gap-2 p-8 text-sm text-muted-foreground"
					>
						Loading sessions…
					</div>
				{:else}
					<SessionList
						sessions={sessionsStore.sessions}
						activeId={page.params['id'] ?? null}
						onSelect={handleSelect}
						onNew={handleNew}
						onChanged={handleSessionsChanged}
					/>
				{/if}
			</div>
		</aside>
	{/if}

	{#if !isDesktop}
		<Sheet.Root bind:open={sessionsStore.historySheetOpen} onOpenChange={handleHistoryOpenChange}>
			<Sheet.Content side="left" class="w-[min(20rem,calc(100vw-2rem))] gap-0 p-0">
				<Sheet.Header class="border-b border-border px-4 py-3 pr-14 text-left">
					<Sheet.Title>Session history</Sheet.Title>
					<Sheet.Description>Return to a recent chat or start a new one.</Sheet.Description>
				</Sheet.Header>
				<div class="min-h-0 flex-1 overflow-y-auto" data-slot="session-list">
					{#if sessionsStore.error}
						<div
							role="alert"
							class="m-3 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive"
						>
							{sessionsStore.error}
							<button
								type="button"
								onclick={() => sessionsStore.load()}
								class="mt-2 block min-h-11 underline">Retry</button
							>
						</div>
					{:else if sessionsStore.loading}
						<div
							class="flex flex-1 items-center justify-center gap-2 p-8 text-sm text-muted-foreground"
						>
							Loading sessions…
						</div>
					{:else}
						<SessionList
							sessions={sessionsStore.sessions}
							activeId={page.params['id'] ?? null}
							onSelect={handleSelect}
							onNew={handleNew}
							onChanged={handleSessionsChanged}
							onSelectSession={() => (sessionsStore.historySheetOpen = false)}
						/>
					{/if}
				</div>
			</Sheet.Content>
		</Sheet.Root>
	{/if}

	<div class="flex min-h-0 min-w-0 flex-1 flex-col">
		{@render children()}
	</div>
</div>

<!-- Single dialog set for the whole app -->
<Dialog.Root bind:open={sessionsStore.renameOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Rename session</Dialog.Title>
			<Dialog.Description>Title must be 1–60 characters.</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-2">
			<Input
				bind:value={sessionsStore.renameValue}
				maxlength={60}
				placeholder="Session title"
				class="min-h-11"
				aria-label="Session title"
			/>
			<div class="flex justify-between text-xs">
				<span class="text-muted-foreground">{sessionsStore.renameValue.length}/60</span>
				{#if sessionsStore.renameError}
					<span class="text-destructive">{sessionsStore.renameError}</span>
				{/if}
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (sessionsStore.renameOpen = false)} class="min-h-11"
				>Cancel</Button
			>
			<Button
				onclick={() => sessionsStore.handleRename()}
				disabled={sessionsStore.renameSaving || !sessionsStore.renameValue.trim()}
				class="min-h-11"
			>
				{sessionsStore.renameSaving ? 'Saving…' : 'Save'}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<AlertDialog.Root bind:open={sessionsStore.deleteOpen}>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>Delete session?</AlertDialog.Title>
			<AlertDialog.Description
				>This cannot be undone. The session will be removed from your list.</AlertDialog.Description
			>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel class="min-h-11">Cancel</AlertDialog.Cancel>
			<AlertDialog.Action
				onclick={() =>
					sessionsStore.handleDelete((deletedId) => {
						const currentId = page.params['id'] as string | undefined;
						if (currentId === deletedId) {
							sessionStore.disconnect();
							goto('/');
						}
					})}
				disabled={sessionsStore.deleteSaving}
				class="bg-destructive text-destructive-foreground hover:bg-destructive/90 min-h-11"
			>
				{sessionsStore.deleteSaving ? 'Deleting…' : 'Delete'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
