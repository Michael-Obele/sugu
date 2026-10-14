/**
 * Single source of truth for slash commands.
 * Both the `/` palette and `/help` render from this registry, so the two
 * cannot disagree about what exists or what each command does.
 */

export type CommandDef = {
	name: string;
	description: string;
	/** true when the command takes trailing text, e.g. `/todo <text>` */
	takesArg?: boolean;
	/** extra search terms so the palette can be filtered by intent */
	keywords?: string[];
};

export const COMMANDS: CommandDef[] = [
	{
		name: 'details',
		description: 'Toggle tool detail level (compact ⇄ full)',
		keywords: ['verbose', 'expand', 'transcript', 'tools']
	},
	{
		name: 'models',
		description: 'Change model for this session',
		keywords: ['provider', 'switch', 'llm']
	},
	{
		name: 'sessions',
		description: 'Open the session list',
		keywords: ['drawer', 'switch', 'history']
	},
	{
		name: 'new',
		description: 'Start a new session',
		keywords: ['create', 'start']
	},
	{
		name: 'export',
		description: 'Download this session as JSONL',
		keywords: ['download', 'jsonl', 'save']
	},
	{
		name: 'help',
		description: 'List the available commands',
		keywords: ['commands', '?']
	},
	{
		name: 'todo',
		description: 'Add a todo item — /todo <text>',
		takesArg: true,
		keywords: ['task', 'list']
	}
];

/** "/models" and "MODELS" both resolve to the `models` command. */
export function getCommand(name: string): CommandDef | undefined {
	const n = normalise(name);
	if (!n) return undefined;
	return COMMANDS.find((c) => c.name === n);
}

export function isKnownCommand(name: string): boolean {
	return getCommand(name) !== undefined;
}

/** Split "/todo buy milk" into { name: 'todo', args: 'buy milk' }. */
export function parseCommand(input: string): { name: string; args: string } | null {
	const trimmed = input.trim();
	if (!trimmed.startsWith('/')) return null;
	const withoutSlash = trimmed.slice(1);
	const spaceIdx = withoutSlash.search(/\s/);
	if (spaceIdx === -1) {
		const name = normalise(withoutSlash);
		return name ? { name, args: '' } : null;
	}
	const name = normalise(withoutSlash.slice(0, spaceIdx));
	const args = withoutSlash.slice(spaceIdx + 1).trim();
	return name ? { name, args } : null;
}

/** Filter by name, description or keywords. Empty query lists everything. */
export function filterCommands(query: string): CommandDef[] {
	const q = normalise(query);
	if (!q) return COMMANDS;
	return COMMANDS.filter(
		(c) =>
			c.name.includes(q) ||
			c.description.toLowerCase().includes(q) ||
			(c.keywords ?? []).some((k) => k.toLowerCase().includes(q))
	);
}

/**
 * What to leave in the composer after the palette inserts a command.
 * Commands that take an argument get a trailing space so typing can continue.
 */
export function commandInsertText(cmd: CommandDef): string {
	return cmd.takesArg ? `/${cmd.name} ` : `/${cmd.name}`;
}

function normalise(value: string): string {
	return value.trim().toLowerCase().replace(/^\//, '');
}
