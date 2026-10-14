<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import {
		getToken,
		logout,
		getModels,
		patchSession,
		exportSession,
		downloadJsonl,
		listSessions
	} from '$lib/api';
	import type { ModelInfo, SessionMeta } from '$lib/api';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import ModelPicker from '$lib/components/ModelPicker.svelte';
	import ArrowLeftIcon from '@lucide/svelte/icons/arrow-left';
	import LogOutIcon from '@lucide/svelte/icons/log-out';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import SettingsIcon from '@lucide/svelte/icons/settings';

	let sessions = $state<SessionMeta[]>([]);
	let selectedId = $state('');
	let selectedSession = $derived(sessions.find((s) => s.id === selectedId) ?? null);
	let models = $state<ModelInfo[]>([]);
	let modelsSource = $state('fallback');
	let defaultModel = $state('deepseek-chat');
	let selectedModel = $state('');
	let savingModel = $state(false);
	let modelError: string | null = $state(null);
	let modelSuccess: string | null = $state(null);

	let quota: {
		day: string;
		turns: number;
		prompt_t: number;
		compl_t: number;
		cost_usd: number;
		caps?: { requests: number; rowsWritten: number; gbs: number; storedGb: number };
		pct?: {
			requests: number | null;
			rowsWritten: number | null;
			gbs: number | null;
			stored: number | null;
		};
		costAlarm?: boolean;
	} | null = $state(null);
	let quotaError: string | null = $state(null);

	function fmtPct(v: number | null | undefined): string {
		if (v === null || v === undefined) return '—';
		return `${v.toFixed(2)}%`;
	}
	function fmtNum(v: number | null | undefined): string {
		if (v === null || v === undefined) return '—';
		return String(v);
	}

	let exportAllLoading = $state(false);

	onMount(async () => {
		const token = getToken();
		if (!token) {
			goto('/login');
			return;
		}
		try {
			sessions = await listSessions();
			if (sessions.length > 0) selectedId = sessions[0]!.id;
		} catch {
			// ignore
		}
		try {
			const res = await getModels();
			models = res.models;
			modelsSource = res.source;
			defaultModel = res.defaultModel;
		} catch {
			// keep fallback
		}
		try {
			const res = await fetch('/api/quota', { headers: { Authorization: `Bearer ${token}` } });
			if (res.ok) quota = await res.json();
			else quotaError = 'quota unavailable';
		} catch {
			quotaError = 'quota unavailable';
		}
		// Set selectedModel from first session's model if available
		if (sessions.length > 0) {
			const first = sessions.find((s) => s.id === selectedId);
			if (first) selectedModel = first.model;
		}
	});

	function handleSessionChange(id: string): void {
		selectedId = id;
		const sess = sessions.find((s) => s.id === id);
		if (sess) selectedModel = sess.model;
		modelError = null;
		modelSuccess = null;
	}

	async function handleModelSave(): Promise<void> {
		if (!selectedId || !selectedModel) return;
		savingModel = true;
		modelError = null;
		modelSuccess = null;
		try {
			await patchSession(selectedId, { model: selectedModel });
			modelSuccess = 'Model updated';
			// Update local sessions
			sessions = sessions.map((s) => (s.id === selectedId ? { ...s, model: selectedModel } : s));
		} catch (e) {
			const err = e as { message?: string };
			modelError = err.message ?? 'Failed to update model';
		} finally {
			savingModel = false;
		}
	}

	async function handleExportAll(): Promise<void> {
		exportAllLoading = true;
		try {
			for (const s of sessions) {
				try {
					const text = await exportSession(s.id);
					downloadJsonl(`${s.id}.jsonl`, text);
					// Small delay to avoid overwhelming
					await new Promise((r) => setTimeout(r, 100));
				} catch {
					// skip failed
				}
			}
		} finally {
			exportAllLoading = false;
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
			class="flex min-h-11 min-w-11 items-center justify-center rounded-md px-2 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
			aria-label="Back"
		>
			<ArrowLeftIcon class="size-4" />
		</a>
		<h1 class="flex items-center gap-2 text-lg font-semibold">
			<SettingsIcon class="size-5" />
			Settings
		</h1>
	</header>

	<main class="flex flex-1 flex-col gap-6 p-4">
		{#if sessions.length > 0}
			<div class="space-y-2">
				<Label for="session-select">Session</Label>
				<Select.Root type="single" value={selectedId} onValueChange={(v) => handleSessionChange(v)}>
					<Select.Trigger
						id="session-select"
						class="h-11 min-h-11 w-full justify-between rounded-md border !bg-card px-3 py-2 text-sm font-normal dark:!bg-card"
					>
						{#if selectedSession}
							<span class="truncate"
								>{selectedSession.title || selectedSession.id.slice(0, 8)} · {selectedSession.model}</span
							>
						{:else}
							<span class="text-muted-foreground">Select session</span>
						{/if}
					</Select.Trigger>
					<Select.Content>
						{#each sessions as s (s.id)}
							<Select.Item value={s.id} label="{s.title || s.id.slice(0, 8)} · {s.model}"
								>{s.title || s.id.slice(0, 8)} · {s.model}</Select.Item
							>
						{/each}
					</Select.Content>
				</Select.Root>
			</div>

			<div class="space-y-2">
				<Label>Model</Label>
				<ModelPicker
					{models}
					value={selectedModel}
					{defaultModel}
					source={modelsSource}
					onSelect={(id) => (selectedModel = id)}
				/>
				{#if modelError}
					<p class="text-sm text-destructive">{modelError}</p>
				{/if}
				{#if modelSuccess}
					<p class="text-sm text-primary">{modelSuccess}</p>
				{/if}
				<Button
					onclick={handleModelSave}
					disabled={savingModel || !selectedModel}
					class="min-h-11 w-full"
				>
					{#if savingModel}
						<Spinner class="size-4" />
						Saving…
					{:else}
						Save model
					{/if}
				</Button>
			</div>

			<Separator />

			<div class="space-y-2">
				<Button
					variant="outline"
					onclick={handleExportAll}
					disabled={exportAllLoading || sessions.length === 0}
					class="min-h-11 w-full gap-2"
				>
					<DownloadIcon class="size-4" />
					{exportAllLoading ? 'Exporting…' : `Export all (${sessions.length})`}
				</Button>
			</div>
		{:else}
			<p class="text-sm text-muted-foreground">No sessions — create one to change its model.</p>
		{/if}

		{#if quota}
			<div class="space-y-2 rounded-xl border p-4">
				<p class="text-sm font-medium">Quota — {quota.day}</p>
				<p class="text-sm text-muted-foreground">
					Turns: {quota.turns} · Prompt: {quota.prompt_t} · Completion: {quota.compl_t} · Cost: ${quota.cost_usd.toFixed(
						4
					)}
				</p>
				<div class="grid grid-cols-2 gap-2 text-xs">
					<div class="rounded-md border bg-card px-3 py-2">
						<p class="text-muted-foreground">Requests</p>
						<p class="font-medium">
							{fmtNum(quota.turns)} / {quota.caps ? fmtNum(quota.caps.requests) : '—'} · {quota.pct
								? fmtPct(quota.pct.requests)
								: '—'}
						</p>
					</div>
					<div class="rounded-md border bg-card px-3 py-2">
						<p class="text-muted-foreground">Rows written</p>
						<p class="font-medium">
							{fmtPct(quota.pct?.rowsWritten)}
							{quota.caps ? `· cap ${quota.caps.rowsWritten.toLocaleString()}` : ''}
						</p>
					</div>
					<div class="rounded-md border bg-card px-3 py-2">
						<p class="text-muted-foreground">GB-s</p>
						<p class="font-medium">
							{fmtPct(quota.pct?.gbs)}
							{quota.caps ? `· cap ${quota.caps.gbs.toLocaleString()}` : ''}
						</p>
					</div>
					<div class="rounded-md border bg-card px-3 py-2">
						<p class="text-muted-foreground">Stored</p>
						<p class="font-medium">
							{fmtPct(quota.pct?.stored)}
							{quota.caps ? `· cap ${quota.caps.storedGb} GB` : ''}
						</p>
					</div>
				</div>
				{#if quota.costAlarm}
					<div
						role="alert"
						class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
					>
						Cost alarm: ${quota.cost_usd.toFixed(4)} today exceeds $1.00
					</div>
				{/if}
			</div>
		{:else if quotaError}
			<div class="rounded-xl border border-dashed p-4">
				<p class="text-sm text-muted-foreground">{quotaError}</p>
			</div>
		{:else}
			<div class="rounded-xl border border-dashed p-4">
				<p class="text-sm text-muted-foreground">Quota — loading…</p>
			</div>
		{/if}

		<div class="mt-auto">
			<Button variant="destructive" onclick={handleLogout} class="min-h-11 w-full gap-2">
				<LogOutIcon class="size-4" />
				Logout
			</Button>
		</div>
	</main>
</div>
