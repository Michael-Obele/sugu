<script lang="ts">
	import { cn } from '$lib/utils';
	import * as Collapsible from '$lib/components/ui/collapsible/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import CheckIcon from '@lucide/svelte/icons/check';
	import CircleIcon from '@lucide/svelte/icons/circle';
	import XIcon from '@lucide/svelte/icons/x';
	import type { TodoEntry } from '$lib/frames';

	type Props = {
		todos: TodoEntry[];
	};

	let { todos }: Props = $props();

	let open = $state(true);

	let openTodos = $derived(todos.filter((t) => t.status === 'open'));
	let doneTodos = $derived(todos.filter((t) => t.status === 'done'));
	let droppedTodos = $derived(todos.filter((t) => t.status === 'dropped'));
</script>

{#if todos.length > 0}
	<Collapsible.Root bind:open class="border-b bg-card/50">
		<Collapsible.Trigger
			class={cn(
				'flex min-h-11 w-full items-center gap-2 px-4 py-2 text-left text-sm font-medium',
				'focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none'
			)}
			aria-label="Todos {todos.length} items"
		>
			<span>Todos</span>
			<Badge variant="secondary" class="text-xs">{openTodos.length} open</Badge>
			{#if doneTodos.length > 0}
				<Badge variant="outline" class="text-xs">{doneTodos.length} done</Badge>
			{/if}
			{#if droppedTodos.length > 0}
				<Badge variant="outline" class="text-xs">{droppedTodos.length} dropped</Badge>
			{/if}
			<ChevronDownIcon
				class="ml-auto size-4 shrink-0 transition-transform group-data-[state=open]/collapsible:rotate-180"
			/>
		</Collapsible.Trigger>
		<Collapsible.Content class="px-4 pb-3">
			<ul class="flex flex-col gap-1.5" role="list">
				{#each todos as todo (todo.id)}
					<li class="flex items-center gap-2 rounded-md border bg-card px-3 py-2 text-sm">
						{#if todo.status === 'done'}
							<CheckIcon class="size-4 shrink-0 text-primary" aria-hidden="true" />
						{:else if todo.status === 'dropped'}
							<XIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						{:else}
							<CircleIcon class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
						{/if}
						<span
							class={cn(
								'flex-1 truncate',
								todo.status === 'done' && 'line-through text-muted-foreground',
								todo.status === 'dropped' && 'line-through text-muted-foreground'
							)}>{todo.text}</span
						>
						<Badge
							variant={todo.status === 'open'
								? 'secondary'
								: todo.status === 'done'
									? 'default'
									: 'outline'}
							class="text-xs shrink-0">{todo.status}</Badge
						>
					</li>
				{/each}
			</ul>
		</Collapsible.Content>
	</Collapsible.Root>
{/if}
