<script lang="ts">
	import { cn } from '$lib/utils';
	import { relativeTime } from '$lib/format';
	import type { SessionMeta } from '$lib/api';
	import { patchSession, deleteSession, exportSession, downloadJsonl } from '$lib/api';
	import * as ContextMenu from '$lib/components/ui/context-menu/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as Empty from '$lib/components/ui/empty/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import PencilIcon from '@lucide/svelte/icons/pencil';
	import TrashIcon from '@lucide/svelte/icons/trash-2';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import EllipsisIcon from '@lucide/svelte/icons/ellipsis-vertical';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import MessageSquareIcon from '@lucide/svelte/icons/message-square';

	type Props = {
		sessions: SessionMeta[];
		onSelect: (id: string) => void;
		onNew: () => void;
		activeId?: string | null;
		onChanged?: () => void;
	};

	let { sessions, onSelect, onNew, activeId = null, onChanged }: Props = $props();

	let renameOpen = $state(false);
	let renameId: string | null = $state(null);
	let renameValue = $state('');
	let renameError: string | null = $state(null);
	let renameSaving = $state(false);

	let deleteOpen = $state(false);
	let deleteId: string | null = $state(null);
	let deleteSaving = $state(false);

	let exportError: string | null = $state(null);

	// long-press handling
	let longPressTimer: ReturnType<typeof setTimeout> | null = null;
	let longPressId: string | null = $state(null);

	function startLongPress(id: string): void {
		longPressId = id;
		longPressTimer = setTimeout(() => {
			// trigger context menu via open state — we use dropdown for mobile, so just highlight
			longPressId = null;
		}, 500);
	}

	function cancelLongPress(): void {
		if (longPressTimer) clearTimeout(longPressTimer);
		longPressTimer = null;
		longPressId = null;
	}

	function openRename(id: string, currentTitle: string): void {
		renameId = id;
		renameValue = currentTitle;
		renameError = null;
		renameOpen = true;
	}

	function openDelete(id: string): void {
		deleteId = id;
		deleteOpen = true;
	}

	async function handleRename(): Promise<void> {
		if (!renameId) return;
		const trimmed = renameValue.trim();
		if (!trimmed) {
			renameError = 'Title cannot be empty';
			return;
		}
		if (trimmed.length > 60) {
			renameError = 'Title must be 60 characters or less';
			return;
		}
		renameSaving = true;
		renameError = null;
		try {
			await patchSession(renameId, { title: trimmed });
			renameOpen = false;
			renameId = null;
			onChanged?.();
		} catch (e) {
			const err = e as { message?: string };
			renameError = err.message ?? 'Rename failed';
		} finally {
			renameSaving = false;
		}
	}

	async function handleDelete(): Promise<void> {
		if (!deleteId) return;
		deleteSaving = true;
		try {
			await deleteSession(deleteId);
			deleteOpen = false;
			deleteId = null;
			onChanged?.();
		} catch (e) {
			// idempotent — even on error, close and refresh
			deleteOpen = false;
			onChanged?.();
		} finally {
			deleteSaving = false;
		}
	}

	async function handleExport(id: string): Promise<void> {
		exportError = null;
		try {
			const text = await exportSession(id);
			downloadJsonl(`${id}.jsonl`, text);
		} catch (e) {
			const err = e as { message?: string };
			exportError = err.message ?? 'Export failed';
		}
	}
</script>

<div class="flex flex-col gap-2 p-4">
	<Button
		variant="outline"
		onclick={onNew}
		class="min-h-11 w-full justify-center gap-2 border-dashed"
	>
		<PlusIcon class="size-4" />
		New session
	</Button>

	{#if exportError}
		<div
			role="alert"
			class="rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive"
		>
			{exportError}
		</div>
	{/if}

	{#each sessions as session (session.id)}
		<ContextMenu.Root>
			<ContextMenu.Trigger>
				{#snippet child({ props })}
					<button
						type="button"
						{...props}
						onclick={() => onSelect(session.id)}
						ontouchstart={() => startLongPress(session.id)}
						ontouchend={cancelLongPress}
						ontouchmove={cancelLongPress}
						class={cn(
							'flex w-full items-center gap-3 rounded-xl border bg-card px-4 py-3 text-left',
							'hover:bg-accent hover:text-accent-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
							'min-h-11',
							activeId === session.id && 'border-primary bg-accent',
							longPressId === session.id && 'bg-accent'
						)}
					>
						<div class="flex flex-1 flex-col items-start gap-1 min-w-0">
							<span class="truncate text-sm font-medium w-full">{session.title || 'Untitled'}</span>
							<span class="text-xs text-muted-foreground truncate w-full">
								{relativeTime(session.updatedAt)} · {session.model}
							</span>
						</div>
						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props: ddProps })}
									<button
										type="button"
										{...ddProps}
										onclick={(e) => e.stopPropagation()}
										class="flex min-h-11 min-w-11 items-center justify-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none shrink-0"
										aria-label="Session actions"
									>
										<EllipsisIcon class="size-4" />
									</button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content align="end">
								<DropdownMenu.Item onclick={() => openRename(session.id, session.title)}>
									<PencilIcon class="size-4" />
									Rename
								</DropdownMenu.Item>
								<DropdownMenu.Item onclick={() => handleExport(session.id)}>
									<DownloadIcon class="size-4" />
									Export JSONL
								</DropdownMenu.Item>
								<DropdownMenu.Separator />
								<DropdownMenu.Item
									onclick={() => openDelete(session.id)}
									class="text-destructive focus:text-destructive"
								>
									<TrashIcon class="size-4" />
									Delete
								</DropdownMenu.Item>
							</DropdownMenu.Content>
						</DropdownMenu.Root>
					</button>
				{/snippet}
			</ContextMenu.Trigger>
			<ContextMenu.Content>
				<ContextMenu.Item onclick={() => openRename(session.id, session.title)}>
					<PencilIcon class="size-4" />
					Rename
				</ContextMenu.Item>
				<ContextMenu.Item onclick={() => handleExport(session.id)}>
					<DownloadIcon class="size-4" />
					Export JSONL
				</ContextMenu.Item>
				<ContextMenu.Separator />
				<ContextMenu.Item
					onclick={() => openDelete(session.id)}
					class="text-destructive focus:text-destructive"
				>
					<TrashIcon class="size-4" />
					Delete
				</ContextMenu.Item>
			</ContextMenu.Content>
		</ContextMenu.Root>
	{:else}
		<Empty.Root class="border border-dashed">
			<Empty.Header>
				<Empty.Media variant="icon">
					<MessageSquareIcon class="size-6" />
				</Empty.Media>
				<Empty.Title>No sessions yet</Empty.Title>
				<Empty.Description>Create one to start chatting</Empty.Description>
			</Empty.Header>
			<Empty.Content>
				<Button variant="outline" onclick={onNew} class="min-h-11">
					<PlusIcon class="size-4" />
					New session
				</Button>
			</Empty.Content>
		</Empty.Root>
	{/each}
</div>

<!-- Rename dialog -->
<Dialog.Root bind:open={renameOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>Rename session</Dialog.Title>
			<Dialog.Description>Title must be 1–60 characters.</Dialog.Description>
		</Dialog.Header>
		<div class="flex flex-col gap-2">
			<Input
				bind:value={renameValue}
				maxlength={60}
				placeholder="Session title"
				class="min-h-11"
				aria-label="Session title"
			/>
			<div class="flex justify-between text-xs">
				<span class="text-muted-foreground">{renameValue.length}/60</span>
				{#if renameError}
					<span class="text-destructive">{renameError}</span>
				{/if}
			</div>
		</div>
		<Dialog.Footer>
			<Button variant="outline" onclick={() => (renameOpen = false)} class="min-h-11">Cancel</Button
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

<!-- Delete confirm -->
<AlertDialog.Root bind:open={deleteOpen}>
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
				onclick={handleDelete}
				disabled={deleteSaving}
				class="bg-destructive text-destructive-foreground hover:bg-destructive/90 min-h-11"
			>
				{deleteSaving ? 'Deleting…' : 'Delete'}
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
