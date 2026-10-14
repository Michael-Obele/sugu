<script lang="ts">
	import { cn } from '$lib/utils';
	import { relativeTime } from '$lib/format';
	import type { SessionMeta } from '$lib/api';
	import { exportSession, downloadJsonl } from '$lib/api';
	import { sessionsStore } from '$lib/sessions.svelte';
	import * as ContextMenu from '$lib/components/ui/context-menu/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Empty from '$lib/components/ui/empty/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
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
		onSelectSession?: () => void;
	};

	let { sessions, onSelect, onNew, activeId = null, onChanged, onSelectSession }: Props = $props();

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
		sessionsStore.openRename(id, currentTitle);
	}

	function openDelete(id: string): void {
		sessionsStore.openDelete(id);
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
						onclick={() => {
							onSelect(session.id);
							onSelectSession?.();
						}}
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
