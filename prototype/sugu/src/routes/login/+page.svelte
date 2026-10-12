<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { login } from '$lib/api';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';

	let passphrase = $state('');
	let error = $state<string | null>(null);
	let loading = $state(false);

	let redirectTo = $derived.by(() => {
		return page.url.searchParams.get('redirect') ?? '/';
	});

	async function handleSubmit(e: SubmitEvent): Promise<void> {
		e.preventDefault();
		if (!passphrase.trim() || loading) return;
		loading = true;
		error = null;
		try {
			await login(passphrase);
			goto(redirectTo);
		} catch (err) {
			const apiErr = err as { status?: number; message?: string };
			if (apiErr.status === 401) {
				error = 'Wrong passphrase';
			} else if (apiErr.status === 429) {
				error = 'Too many attempts, wait a few minutes';
			} else {
				error = apiErr.message ?? 'Login failed';
			}
		} finally {
			loading = false;
		}
	}
</script>

<div
	class="safe-top safe-bottom flex min-h-dvh flex-col items-center justify-center bg-background p-4"
>
	<div class="w-full max-w-sm space-y-6">
		<h1 class="text-center text-2xl font-semibold">Sugu</h1>
		<form onsubmit={handleSubmit} class="space-y-4">
			<div class="space-y-2">
				<label for="passphrase" class="text-sm font-medium">Passphrase</label>
				<Input
					id="passphrase"
					type="password"
					bind:value={passphrase}
					placeholder="Enter passphrase"
					autocomplete="current-password"
					disabled={loading}
					class="min-h-[44px]"
				/>
			</div>
			{#if error}
				<p role="alert" class="text-sm text-destructive">{error}</p>
			{/if}
			<Button type="submit" disabled={loading || !passphrase.trim()} class="min-h-[44px] w-full">
				{loading ? 'Signing in…' : 'Sign in'}
			</Button>
		</form>
	</div>
</div>
