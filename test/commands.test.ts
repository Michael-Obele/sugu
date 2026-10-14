import { describe, test, expect } from 'bun:test';
import { COMMANDS, commandInsertText, filterCommands, getCommand, isKnownCommand, parseCommand } from '../sugu/src/lib/commands';

describe('COMMANDS registry', () => {
	test('exposes the batch 3F vocabulary in value order', () => {
		expect(COMMANDS.map((c) => c.name)).toEqual(['details', 'models', 'sessions', 'new', 'export', 'help', 'todo']);
	});

	test('every command has a one-line description', () => {
		for (const c of COMMANDS) {
			expect(c.description.length).toBeGreaterThan(0);
			expect(c.description.includes('\n')).toBe(false);
		}
	});

	test('only /todo takes an argument', () => {
		expect(COMMANDS.filter((c) => c.takesArg).map((c) => c.name)).toEqual(['todo']);
	});
});

describe('parseCommand', () => {
	test('returns null for plain messages', () => {
		expect(parseCommand('hello')).toBeNull();
		expect(parseCommand('what about /details?')).toBeNull();
		expect(parseCommand('')).toBeNull();
	});

	test('returns null for a bare slash and a bare space', () => {
		expect(parseCommand('/')).toBeNull();
		expect(parseCommand('/ ')).toBeNull();
		expect(parseCommand('   ')).toBeNull();
	});

	test('parses a command without arguments', () => {
		expect(parseCommand('/details')).toEqual({ name: 'details', args: '' });
		expect(parseCommand('  /help  ')).toEqual({ name: 'help', args: '' });
	});

	test('parses a command with arguments', () => {
		expect(parseCommand('/todo buy milk')).toEqual({ name: 'todo', args: 'buy milk' });
		expect(parseCommand('/todo   padded  ')).toEqual({ name: 'todo', args: 'padded' });
	});

	test('lowercases the name but preserves argument case', () => {
		expect(parseCommand('/DETAILS')).toEqual({ name: 'details', args: '' });
		expect(parseCommand('/todo Buy Milk')).toEqual({ name: 'todo', args: 'Buy Milk' });
	});

	test('parses an unknown command name — the registry decides if it exists', () => {
		expect(parseCommand('/nope')).toEqual({ name: 'nope', args: '' });
		expect(isKnownCommand('nope')).toBe(false);
	});
});

describe('resolve', () => {
	test('getCommand accepts with or without the slash and any case', () => {
		expect(getCommand('/models')?.name).toBe('models');
		expect(getCommand('MODELS')?.name).toBe('models');
		expect(getCommand(' models ')?.name).toBe('models');
	});

	test('unknown and empty names resolve to nothing', () => {
		expect(getCommand('/nope')).toBeUndefined();
		expect(getCommand('')).toBeUndefined();
		expect(getCommand('/')).toBeUndefined();
	});

	test('isKnownCommand distinguishes the vocabulary from everything else', () => {
		for (const c of COMMANDS) expect(isKnownCommand(c.name)).toBe(true);
		expect(isKnownCommand('/editor')).toBe(false);
		expect(isKnownCommand('/undo')).toBe(false);
	});
});

describe('filterCommands', () => {
	test('empty query lists the whole registry in order', () => {
		expect(filterCommands('')).toEqual(COMMANDS);
		expect(filterCommands('   ')).toEqual(COMMANDS);
		expect(filterCommands('/')).toEqual(COMMANDS);
	});

	test('matches a name prefix, with or without the slash', () => {
		expect(filterCommands('det').map((c) => c.name)).toEqual(['details']);
		expect(filterCommands('/mod').map((c) => c.name)).toEqual(['models']);
	});

	test('matches inside a name', () => {
		expect(filterCommands('port').map((c) => c.name)).toEqual(['export']);
	});

	test('matches a description word', () => {
		expect(filterCommands('detail level').map((c) => c.name)).toEqual(['details']);
		expect(filterCommands('jsonl').map((c) => c.name)).toEqual(['export']);
	});

	test('matches a keyword', () => {
		expect(filterCommands('verbose').map((c) => c.name)).toEqual(['details']);
		expect(filterCommands('drawer').map((c) => c.name)).toEqual(['sessions']);
	});

	test('an unknown query filters everything out', () => {
		expect(filterCommands('zzzz')).toEqual([]);
		expect(filterCommands('/nope')).toEqual([]);
	});

	test('is case-insensitive', () => {
		expect(filterCommands('HELP').map((c) => c.name)).toEqual(['help']);
	});
});

describe('commandInsertText', () => {
	test('no argument command inserts just the name', () => {
		expect(commandInsertText(getCommand('details')!)).toBe('/details');
	});

	test('argument command inserts a trailing space for typing', () => {
		expect(commandInsertText(getCommand('todo')!)).toBe('/todo ');
	});
});
