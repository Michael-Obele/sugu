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
		sessionStore.connect(id, flushPending);
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
		// Handle rapid navigation between sessions without $effect
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
</script>

<div class="flex h-dvh flex-col bg-background">
	<ConnectionBanner state={sessionStore.connection} />

	<header class="safe-top flex h-14 shrink-0 items-center gap-2 border-b px-4">
		<a
			href="/"
			class="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-md px-2 text-sm hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
			aria-label="Back to sessions"
		>
			←
		</a>
		<span class="flex-1 truncate text-sm font-medium">{sessionId.slice(0, 8)}</span>
		<span class="text-xs text-muted-foreground">
			{sessionStore.connection === 'open' ? '●' : '○'}
		</span>
	</header>

	<div class="flex-1 overflow-y-auto">
		<MessageList
			messages={sessionStore.messages}
			tools={sessionStore.tools}
			onRerun={handleRerun}
		/>
	</div>

	<Composer
		bind:value={composerText}
		busy={sessionStore.busy}
		disabled={sessionStore.connection !== 'open' && sessionStore.connection !== 'reconnecting'}
		onSend={handleSend}
		onCancel={handleCancel}
	/>
</div>
