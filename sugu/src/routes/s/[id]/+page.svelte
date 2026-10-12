<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { afterNavigate } from '$app/navigation';
	import { goto } from '$app/navigation';
	import { getToken, setOnUnauthorized } from '$lib/api';
	import { sessionStore } from '$lib/session.svelte';

	import ConnectionBanner from '$lib/components/ConnectionBanner.svelte';
	import MessageList from '$lib/components/MessageList.svelte';
	import Composer from '$lib/components/Composer.svelte';

	let sessionId = $derived(page.params['id'] ?? '');
	let composerText = $state('');
	let pendingSend = $state<string | null>(null);
	let lastConnectedId: string | null = null;

	function doConnect(id: string): void {
		if (!id) return;
		if (lastConnectedId === id) return;
		const token = getToken();
		if (!token) {
			goto(`/login?redirect=${encodeURIComponent(`/s/${id}`)}`);
			return;
		}
		lastConnectedId = id;
		sessionStore.connect(
			id,
			flushPending,
			(text) => {
				composerText = text;
			}
		);
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

	function handleSend(text: string): void {
		if (sessionStore.connection !== 'open') {
			pendingSend = text;
			composerText = text;
			return;
		}
		sessionStore.send(text);
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

	let connectionLabel = $derived(
		sessionStore.connection === 'open' ? 'Connected' : sessionStore.connection === 'reconnecting' ? 'Reconnecting' : sessionStore.connection === 'connecting' ? 'Connecting' : 'Offline'
	);
</script>

<div class="flex h-dvh flex-col bg-background">
	<ConnectionBanner state={sessionStore.connection} />

	{#if sessionStore.error}
		<div role="alert" class="flex items-center justify-between gap-2 bg-destructive px-4 py-2 text-sm text-destructive-foreground">
			<span>{sessionStore.error}</span>
			<button type="button" onclick={() => (sessionStore.error = null)} class="min-h-[44px] min-w-[44px] rounded-md px-2 text-xs underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">Dismiss</button>
		</div>
	{/if}

	<header class="safe-top flex h-14 shrink-0 items-center gap-2 border-b px-4">
		<a
			href="/"
			class="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-2 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
			aria-label="Back to sessions"
		>
			\u2190
		</a>
		<span class="flex-1 truncate text-sm font-medium">{sessionId.slice(0, 8)}</span>
		<span class="flex items-center gap-1.5 text-xs {sessionStore.connection === 'open' ? 'text-emerald-500' : sessionStore.connection === 'reconnecting' ? 'text-warning' : 'text-muted-foreground'}" aria-label={connectionLabel} title={connectionLabel}>
			<span class="h-2 w-2 rounded-full {sessionStore.connection === 'open' ? 'bg-emerald-500' : sessionStore.connection === 'reconnecting' ? 'bg-warning animate-pulse' : 'bg-muted-foreground'}" aria-hidden="true"></span>
			{connectionLabel}
		</span>
	</header>

	<MessageList
		messages={sessionStore.messages}
		tools={sessionStore.tools}
		errs={sessionStore.errs}
		pendingSends={sessionStore.pendingSends}
		onRerun={handleRerun}
		onRetryPending={handleRetryPending}
		onDismissPending={handleDismissPending}
	/>

	<Composer
		bind:value={composerText}
		busy={sessionStore.busy}
		disabled={sessionStore.connection !== 'open' && sessionStore.connection !== 'reconnecting'}
		onSend={handleSend}
		onCancel={handleCancel}
	/>
</div>
