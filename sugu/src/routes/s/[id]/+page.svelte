<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { goto } from '$app/navigation';
	import {
		getToken,
		setOnUnauthorized,
		getEventsPage,
		getModels,
		getSkills,
		patchSession,
		exportSession,
		downloadJsonl
	} from '$lib/api';
	import type { ModelInfo, SkillInfo } from '$lib/api';
	import { sessionStore } from '$lib/session.svelte';
	import { COMMANDS } from '$lib/commands';
	import { detailLevelStore } from '$lib/detail-level.svelte';
	import { thinkingStore } from '$lib/thinking.svelte';
	import { applyFrame } from '$lib/frames';
	import type { Frame } from '../../../../../src/shared/contracts';

	import ConnectionBanner from '$lib/components/ConnectionBanner.svelte';
	import MessageList from '$lib/components/MessageList.svelte';
	import Composer from '$lib/components/Composer.svelte';
	import TodoPanel from '$lib/components/TodoPanel.svelte';
	import ModelPicker from '$lib/components/ModelPicker.svelte';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis-vertical';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';

	let sessionId = $derived(page.params['id'] ?? '');
	let composerText = $state('');
	let pendingSend = $state<string | null>(null);
	let lastConnectedId: string | null = null;

	let hasMore = $state(false);
	let loadingEarlier = $state(false);
	let quota: {
		day: string;
		turns: number;
		prompt_t: number;
		compl_t: number;
		cost_usd: number;
	} | null = $state(null);

	let skills = $state<SkillInfo[]>([]);
	let skillsConfigured = $state(true);
	let skillsError = $state<string | undefined>(undefined);
	let selectedSkills = $state<string[]>([]);

	let showModelDialog = $state(false);
	let models = $state<ModelInfo[]>([]);
	let modelsSource = $state('fallback');
	let selectedModel = $state('');
	let savingModel = $state(false);

	let showRenameDialog = $state(false);
	let renameValue = $state('');
	let renameSaving = $state(false);

	let showHelpDialog = $state(false);
	let detailLevel = $derived(detailLevelStore.level);
	let thinkingMode = $derived(thinkingStore.mode);

	async function loadSkills(): Promise<void> {
		try {
			const res = await getSkills();
			skills = res.skills;
			skillsConfigured = res.configured;
			skillsError = res.error;
		} catch (e) {
			skillsError = e instanceof Error ? e.message : String(e);
		}
	}

	function doConnect(id: string): void {
		if (!id) return;
		if (lastConnectedId === id) return;
		const token = getToken();
		if (!token) {
			goto(`/login?redirect=${encodeURIComponent(`/s/${id}`)}`);
			return;
		}
		lastConnectedId = id;
		sessionStore.connect(id, flushPending, (text) => {
			composerText = text;
		});
		// Check if history is paginated — fetch hasMore for initial page
		checkHasMore(id);
		loadQuota();
	}

	async function checkHasMore(id: string): Promise<void> {
		try {
			const page = await getEventsPage(id, { limit: 50 });
			// If we have fewer messages than the page, there might be more
			// Actually hasMore from the API tells us if there are older events
			// We need to compare: if current messages length < total, hasMore true
			// Simpler: if the page has hasMore, show button
			// But we already have messages via WS — use the API's hasMore with before=minSeq
			const minSeq =
				sessionStore.messages.length > 0
					? Math.min(...sessionStore.messages.map((m) => m.seq))
					: undefined;
			if (minSeq !== undefined && minSeq > 1) {
				const older = await getEventsPage(id, { before: minSeq, limit: 1 });
				hasMore = older.frames.length > 0 || older.hasMore;
			} else {
				hasMore = page.hasMore;
			}
		} catch {
			hasMore = false;
		}
	}

	async function loadQuota(): Promise<void> {
		try {
			const token = getToken();
			if (!token) return;
			const res = await fetch('/api/quota', { headers: { Authorization: `Bearer ${token}` } });
			if (res.ok) quota = await res.json();
		} catch {
			// ignore
		}
	}

	async function handleLoadEarlier(): Promise<void> {
		if (loadingEarlier || !hasMore) return;
		const minSeq =
			sessionStore.messages.length > 0
				? Math.min(...sessionStore.messages.map((m) => m.seq))
				: undefined;
		if (minSeq === undefined) return;
		loadingEarlier = true;
		try {
			const pageData = await getEventsPage(sessionId, { before: minSeq, limit: 50 });
			// Prepend older frames — apply each frame to the store
			for (const raw of pageData.frames) {
				const frame = raw as Frame;
				sessionStore.frameState = applyFrame(sessionStore.frameState, frame);
			}
			hasMore = pageData.hasMore;
		} catch {
			// ignore
		} finally {
			loadingEarlier = false;
		}
	}

	function flushPending(): void {
		if (pendingSend && sessionStore.connection === 'open') {
			const text = pendingSend;
			pendingSend = null;
			composerText = '';
			sessionStore.send(text);
		}
	}

	onMount(() => {
		const token = getToken();
		if (!token) {
			goto(`/login?redirect=${encodeURIComponent(`/s/${sessionId}`)}`);
			return;
		}
		setOnUnauthorized(() => goto(`/login?redirect=${encodeURIComponent(`/s/${sessionId}`)}`));
		doConnect(sessionId);
		loadSkills();

		return () => {
			sessionStore.disconnect();
			lastConnectedId = null;
		};
	});

	afterNavigate(() => {
		const id = page.params['id'] ?? '';
		if (id && id !== lastConnectedId) {
			doConnect(id);
		}
	});

	function handleSend(text: string, skills?: string[]): void {
		// Local /todo affordance — handle before any network
		const todoParsed = sessionStore.parseTodoCommand(text);
		if (todoParsed.isTodo && todoParsed.todoText) {
			sessionStore.addLocalTodo(text);
			composerText = '';
			return;
		}
		const toSend = skills ?? selectedSkills;
		if (sessionStore.connection !== 'open') {
			pendingSend = text;
			composerText = text;
			return;
		}
		sessionStore.send(text, toSend.length > 0 ? toSend : undefined);
		selectedSkills = [];
	}

	function handleCancel(): void {
		sessionStore.cancel();
	}

	function handleRerun(text: string): void {
		handleSend(text);
	}

	function handleRetryPending(id: string): void {
		sessionStore.retryPending(id);
	}

	function handleDismissPending(id: string): void {
		sessionStore.dismissPending(id);
	}

	async function handleExport(): Promise<void> {
		try {
			const text = await exportSession(sessionId);
			downloadJsonl(`${sessionId}.jsonl`, text);
		} catch {
			// ignore
		}
	}

	async function openModelPicker(): Promise<void> {
		showModelDialog = true;
		selectedModel = sessionStore.frameState.model || 'deepseek-chat';
		try {
			const res = await getModels();
			models = res.models;
			modelsSource = res.source;
		} catch {
			// keep fallback
		}
	}

	async function handleModelChange(): Promise<void> {
		if (!selectedModel) return;
		savingModel = true;
		try {
			await patchSession(sessionId, { model: selectedModel });
			sessionStore.frameState = { ...sessionStore.frameState, model: selectedModel };
			showModelDialog = false;
		} catch {
			// ignore
		} finally {
			savingModel = false;
		}
	}

	function openRename(): void {
		renameValue = sessionId.slice(0, 60);
		showRenameDialog = true;
	}

	async function handleRename(): Promise<void> {
		const trimmed = renameValue.trim();
		if (!trimmed) return;
		renameSaving = true;
		try {
			await patchSession(sessionId, { title: trimmed.slice(0, 60) });
			showRenameDialog = false;
		} catch {
			// ignore
		} finally {
			renameSaving = false;
		}
	}

	async function handleCommand(name: string, args: string): Promise<void> {
		if (name === 'thinking') {
			thinkingStore.toggle();
			return;
		}
		if (name === 'details') {
			detailLevelStore.toggle();
			return;
		}
		if (name === 'models') {
			await openModelPicker();
			return;
		}
		if (name === 'sessions') {
			goto('/');
			return;
		}
		if (name === 'new') {
			goto('/');
			return;
		}
		if (name === 'export') {
			await handleExport();
			return;
		}
		if (name === 'help') {
			showHelpDialog = true;
			return;
		}
		if (name === 'todo') {
			if (args) {
				sessionStore.addLocalTodo(`/todo ${args}`);
			}
			return;
		}
	}

	let connectionLabel = $derived(
		sessionStore.connection === 'open'
			? 'Connected'
			: sessionStore.connection === 'reconnecting'
				? 'Reconnecting'
				: sessionStore.connection === 'connecting'
					? 'Connecting'
					: 'Offline'
	);

	let statusLine = $derived.by(() => {
		const parts: string[] = [];
		if (sessionStore.frameState.model) parts.push(sessionStore.frameState.model);
		if (quota) parts.push(`$${quota.cost_usd.toFixed(4)} today`);
		parts.push(connectionLabel);
		return parts.join(' · ');
	});
</script>

<div class="flex h-dvh flex-col bg-background">
	<ConnectionBanner state={sessionStore.connection} />

	{#if sessionStore.error}
		<div
			role="alert"
			class="flex items-center justify-between gap-2 bg-destructive px-4 py-2 text-sm text-destructive-foreground"
		>
			<span>{sessionStore.error}</span>
			<button
				type="button"
				onclick={() => (sessionStore.error = null)}
				class="min-h-11 min-w-11 rounded-md px-2 text-xs underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
				>Dismiss</button
			>
		</div>
	{/if}

	<header class="safe-top flex h-14 shrink-0 items-center gap-2 border-b px-4">
		<a
			href="/"
			class="flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
			aria-label="Back to sessions"
		>
			<ArrowLeftIcon class="size-4" />
		</a>
		<span class="flex-1 truncate text-sm font-medium">{sessionId.slice(0, 8)}</span>
		<span
			class="flex items-center gap-1.5 text-xs {sessionStore.connection === 'open'
				? 'text-muted-foreground'
				: sessionStore.connection === 'reconnecting'
					? 'text-warning'
					: 'text-muted-foreground'}"
			aria-label={connectionLabel}
			title={connectionLabel}
		>
			{#if sessionStore.connection === 'reconnecting' || sessionStore.connection === 'connecting'}
				<Spinner class="size-3" />
			{:else}
				<span
					class="h-2 w-2 rounded-full {sessionStore.connection === 'open'
						? 'bg-primary'
						: 'bg-muted-foreground'}"
					aria-hidden="true"
				></span>
			{/if}
			{connectionLabel}
		</span>
		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<button
						type="button"
						{...props}
						class="flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
						aria-label="Session actions"
					>
						<EllipsisIcon class="size-4" />
					</button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end">
				<DropdownMenu.Item onclick={openRename}>
					<PencilIcon class="size-4" />
					Rename
				</DropdownMenu.Item>
				<DropdownMenu.Item onclick={openModelPicker}>
					Model: {sessionStore.frameState.model}
				</DropdownMenu.Item>
				<DropdownMenu.Item onclick={handleExport}>
					<DownloadIcon class="size-4" />
					Export JSONL
				</DropdownMenu.Item>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</header>

	<div
		class="flex items-center gap-2 px-4 py-1.5 text-xs text-muted-foreground border-b bg-card/50"
	>
		<span class="truncate">{statusLine}</span>
		{#if sessionStore.busy}
			<Badge variant="secondary" class="ml-auto text-xs gap-1">
				<Spinner class="size-3" />
				busy
			</Badge>
		{/if}
	</div>

	<TodoPanel todos={sessionStore.todos} />

	<MessageList
		messages={sessionStore.messages}
		tools={sessionStore.tools}
		{detailLevel}
		{thinkingMode}
		errs={sessionStore.errs}
		pendingSends={sessionStore.pendingSends}
		{hasMore}
		{loadingEarlier}
		onLoadEarlier={handleLoadEarlier}
		onRerun={handleRerun}
		onRetryPending={handleRetryPending}
		onDismissPending={handleDismissPending}
	/>

	<Composer
		bind:value={composerText}
		busy={sessionStore.busy}
		disabled={sessionStore.connection !== 'open' && sessionStore.connection !== 'reconnecting'}
		{skills}
		{skillsConfigured}
		{skillsError}
		bind:selectedSkills
		onSend={handleSend}
		onCancel={handleCancel}
		onCommand={handleCommand}
	/>

	<!-- Model picker dialog -->
	<Dialog.Root bind:open={showModelDialog}>
		<Dialog.Content class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>Change model</Dialog.Title>
				<Dialog.Description>Select a model for this session.</Dialog.Description>
			</Dialog.Header>
			<div class="flex flex-col gap-4">
				<ModelPicker
					{models}
					value={selectedModel}
					source={modelsSource}
					onSelect={(id) => (selectedModel = id)}
				/>
			</div>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (showModelDialog = false)} class="min-h-11"
					>Cancel</Button
				>
				<Button
					onclick={handleModelChange}
					disabled={savingModel || !selectedModel}
					class="min-h-11"
				>
					{savingModel ? 'Saving…' : 'Save'}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<!-- Rename dialog -->
	<Dialog.Root bind:open={showRenameDialog}>
		<Dialog.Content class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>Rename session</Dialog.Title>
				<Dialog.Description>Title must be 1–60 characters.</Dialog.Description>
			</Dialog.Header>
			<div class="flex flex-col gap-2">
				<Label for="rename-input">Title</Label>
				<Input id="rename-input" bind:value={renameValue} maxlength={60} class="min-h-11" />
				<span class="text-xs text-muted-foreground">{renameValue.length}/60</span>
			</div>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (showRenameDialog = false)} class="min-h-11"
					>Cancel</Button
				>
				<Button
					onclick={handleRename}
					disabled={renameSaving || !renameValue.trim()}
					class="min-h-11"
				>
					{renameSaving ? 'Saving…' : 'Save'}
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>

	<!-- Help dialog — renders from the same COMMANDS registry as the palette -->
	<Dialog.Root bind:open={showHelpDialog}>
		<Dialog.Content class="sm:max-w-md">
			<Dialog.Header>
				<Dialog.Title>Commands</Dialog.Title>
				<Dialog.Description>Available slash commands.</Dialog.Description>
			</Dialog.Header>
			<div class="flex flex-col gap-1 py-2">
				{#each COMMANDS as cmd (cmd.name)}
					<div class="flex items-baseline gap-2 rounded-md px-3 py-2">
						<span class="shrink-0 font-mono text-sm font-medium">/{cmd.name}</span>
						<span class="text-sm text-muted-foreground">{cmd.description}</span>
					</div>
				{/each}
			</div>
			<Dialog.Footer>
				<Button variant="outline" onclick={() => (showHelpDialog = false)} class="min-h-11"
					>Close</Button
				>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
</div>
