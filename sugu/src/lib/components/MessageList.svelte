<script lang="ts">
	import { cn } from '$lib/utils';
	import { createAnnouncer } from '$lib/announce';
	import type { DisplayMessage, ToolEntry, ErrEntry } from '$lib/frames';
	import * as MessageScroller from '$lib/components/ui/message-scroller/index.js';
	import * as Message from '$lib/components/ui/message/index.js';
	import * as Bubble from '$lib/components/ui/bubble/index.js';
	import * as Marker from '$lib/components/ui/marker/index.js';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Spinner } from '$lib/components/ui/spinner/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import ChevronUpIcon from '@lucide/svelte/icons/chevron-up';
	import RotateCcwIcon from '@lucide/svelte/icons/rotate-ccw';
	import AlertTriangleIcon from '@lucide/svelte/icons/alert-triangle';

	type Props = {
		messages: DisplayMessage[];
		tools?: ToolEntry[];
		errs?: ErrEntry[];
		pendingSends?: {
			id: string;
			text: string;
			status: 'pending' | 'sent' | 'failed';
			error?: string;
		}[];
		detailLevel?: 'compact' | 'full';
		hasMore?: boolean;
		loadingEarlier?: boolean;
		onLoadEarlier?: () => void;
		onRerun?: (text: string) => void;
		onRetryPending?: (id: string) => void;
		onDismissPending?: (id: string) => void;
	};

	let {
		messages,
		tools = [],
		errs = [],
		pendingSends = [],
		detailLevel = 'compact',
		hasMore = false,
		loadingEarlier = false,
		onLoadEarlier,
		onRerun,
		onRetryPending,
		onDismissPending
	}: Props = $props();

	function toolsForSeq(seq: number): ToolEntry[] {
		return tools.filter((t) => t.seq === seq);
	}

	// aria-live throttling: roughly once a second with a trailing flush, so a screen
	// reader gets readable updates instead of a burst per token.
	const announcer = createAnnouncer(1000);
	let announceText = $state('');

	// Announcing to a screen reader is an EXTERNAL side effect (it writes to the DOM/AT
	// layer), which is exactly what $effect is for. It is NOT for syncing derived state.
	// Driving this from a render-time function instead mutated $state during render, which
	// Svelte 5 rejects with state_unsafe_mutation and which crashed the whole chat page.
	const latestMessage = $derived(messages.at(-1));
	$effect(() => {
		const text = latestMessage?.text ?? '';
		if (latestMessage?.streaming) {
			announceText = announcer.throttled(text);
		} else {
			announcer.flush();
			announceText = text;
		}
	});

	function truncate(text: string, max = 800): { display: string; truncated: boolean } {
		if (text.length <= max) return { display: text, truncated: false };
		return { display: text.slice(0, max), truncated: true };
	}
</script>

<div class="flex min-h-0 flex-1 flex-col">
	<!-- One live region for the whole chat. Announcing per message would make a screen
	     reader re-read the transcript on every token. -->
	<span class="sr-only" aria-live="polite" aria-atomic="true">{announceText}</span>
	{#if hasMore}
		<div class="flex justify-center p-2">
			<Button
				variant="outline"
				size="sm"
				disabled={loadingEarlier}
				onclick={() => onLoadEarlier?.()}
				class="min-h-[44px] gap-1.5"
			>
				{#if loadingEarlier}
					<Spinner class="size-4" />
					Loading…
				{:else}
					<ChevronUpIcon class="size-4" />
					Load earlier
				{/if}
			</Button>
		</div>
	{/if}

	<MessageScroller.Provider autoScroll>
		<MessageScroller.Root class="min-h-0 flex-1">
			<MessageScroller.Viewport class="p-4">
				<MessageScroller.Content class="gap-3">
					{#each messages as msg (msg.seq)}
						<MessageScroller.Item>
							<Message.Root align={msg.role === 'user' ? 'end' : 'start'}>
								<Bubble.Root
									variant={msg.role === 'user'
										? 'default'
										: msg.interrupted
											? 'destructive'
											: 'secondary'}
									align={msg.role === 'user' ? 'end' : 'start'}
									class={cn(msg.streaming && 'streaming', msg.interrupted && 'border-dashed')}
								>
									<Bubble.Content class="break-words whitespace-pre-wrap">
										{msg.text}
										{#if msg.streaming}
											<span
												class="ml-0.5 inline-block h-4 w-2 animate-pulse bg-foreground/30 align-text-bottom"
												aria-hidden="true"
											></span>
										{/if}
									</Bubble.Content>
								</Bubble.Root>
							</Message.Root>

							{#if msg.interrupted}
								<Marker.Root variant="default" class="gap-2 py-1">
									<AlertTriangleIcon class="size-4 text-warning" />
									<span class="text-xs text-warning">Interrupted</span>
									{#if onRerun}
										<Button
											variant="outline"
											size="xs"
											onclick={() => onRerun(msg.text)}
											class="ml-2 min-h-[32px] gap-1"
										>
											<RotateCcwIcon class="size-3" />
											Re-run
										</Button>
									{/if}
								</Marker.Root>
							{/if}

							{#each toolsForSeq(msg.seq) as tool (tool.runId)}
								{@const trunc = truncate(tool.summary ?? '', 800)}
								<Collapsible.Root class="w-full">
									<Collapsible.Trigger
										class={cn(
											'flex min-h-[44px] w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
											tool.status === 'failed'
												? 'border-destructive/50 bg-destructive/10 text-destructive'
												: 'border-border bg-card text-muted-foreground'
										)}
										aria-label={`Tool ${tool.name} ${tool.status}`}
										disabled={detailLevel === 'compact'}
									>
										<span class="truncate font-mono text-xs">ran `{tool.name}`</span>
										{#if tool.durationMs !== undefined}
											<span class="text-xs text-muted-foreground tabular-nums"
												>{tool.durationMs}ms</span
											>
										{/if}
										{#if tool.status === 'ok'}
											<Badge variant="secondary" class="ml-auto text-xs">ok</Badge>
										{:else if tool.status === 'failed'}
											<Badge variant="destructive" class="ml-auto text-xs">failed</Badge>
										{:else}
											<Spinner class="ml-auto size-3" />
										{/if}
										{#if detailLevel === 'full'}
											<ChevronDownIcon
												class="size-4 shrink-0 opacity-50 transition-transform group-data-[state=open]/collapsible:rotate-180"
											/>
										{/if}
									</Collapsible.Trigger>
									{#if detailLevel === 'full' && tool.summary}
										<Collapsible.Content class="mt-1 rounded-md border bg-card p-3 text-sm">
											<pre class="text-xs break-words whitespace-pre-wrap">{trunc.display}</pre>
											{#if trunc.truncated || tool.truncated}
												<p class="mt-2 text-xs text-muted-foreground">
													…[truncated to 48KB]{#if trunc.truncated}
														— {tool.summary.length - 800} chars hidden{/if}
												</p>
											{/if}
											{#if tool.status === 'failed'}
												<p class="mt-2 text-xs text-destructive">
													Tool failed — error details above
												</p>
											{/if}
										</Collapsible.Content>
									{/if}
								</Collapsible.Root>
							{/each}
						</MessageScroller.Item>
					{:else}
						<div class="py-8 text-center">
							<p class="text-sm text-muted-foreground">No messages yet — say hello</p>
						</div>
					{/each}

					{#each pendingSends as p (p.id)}
						<MessageScroller.Item>
							<div
								class={cn(
									'flex items-center gap-2 rounded-xl border px-4 py-3 text-sm',
									p.status === 'failed'
										? 'border-destructive/50 bg-destructive/10'
										: 'border-border bg-card opacity-60'
								)}
							>
								<span class="flex-1 truncate">{p.text}</span>
								{#if p.status === 'pending'}
									<span class="flex items-center gap-1.5 text-xs text-muted-foreground">
										<Spinner class="size-3" />
										Sending…
									</span>
								{:else if p.status === 'failed'}
									<span class="text-xs text-destructive">{p.error ?? 'Failed'}</span>
									<Button
										variant="default"
										size="xs"
										onclick={() => onRetryPending?.(p.id)}
										class="min-h-[32px]"
									>
										Retry
									</Button>
									<Button
										variant="outline"
										size="xs"
										onclick={() => onDismissPending?.(p.id)}
										class="min-h-[32px]"
									>
										Dismiss
									</Button>
								{/if}
							</div>
						</MessageScroller.Item>
					{/each}

					{#each errs as e (e.at)}
						<MessageScroller.Item>
							<div
								role="alert"
								class="rounded-xl border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive"
							>
								<span class="font-medium">{e.code}:</span>
								{e.message}
							</div>
						</MessageScroller.Item>
					{/each}
				</MessageScroller.Content>
			</MessageScroller.Viewport>
			<MessageScroller.Button
				variant="secondary"
				size="icon-sm"
				class="rounded-full shadow-lg"
				aria-label="Jump to latest"
			>
				<ChevronDownIcon class="size-4" />
			</MessageScroller.Button>
		</MessageScroller.Root>
	</MessageScroller.Provider>
</div>
