<script lang="ts">
	import MessageBubble from './MessageBubble.svelte';
	import ToolRow from './ToolRow.svelte';
	import type { DisplayMessage, ToolEntry } from '$lib/frames';

	type Props = {
		messages: DisplayMessage[];
		tools?: ToolEntry[];
		onRerun?: (text: string) => void;
	};

	let { messages, tools = [], onRerun }: Props = $props();

	function toolsForSeq(seq: number): ToolEntry[] {
		return tools.filter((t) => t.seq === seq);
	}
</script>

<div class="flex flex-col gap-3 p-4">
	{#each messages as msg (msg.seq)}
		<MessageBubble
			role={msg.role}
			text={msg.text}
			streaming={msg.streaming}
			interrupted={msg.interrupted}
			onRerun={msg.interrupted && onRerun ? () => onRerun(msg.text) : undefined}
		/>
		{#each toolsForSeq(msg.seq) as tool (tool.runId)}
			<ToolRow name={tool.name} status={tool.status} summary={tool.summary} />
		{/each}
	{:else}
		<p class="py-8 text-center text-sm text-muted-foreground">No messages yet</p>
	{/each}
</div>
