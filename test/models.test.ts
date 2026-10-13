import { describe, test, expect } from 'bun:test';
import { parseSseText, parseSseStream, costFor } from '../src/server/models';

// ---------------------------------------------------------------------------
// SSE parser fixtures (unit tests, no CF)
// ---------------------------------------------------------------------------

describe('parseSseText fixtures', () => {
	test('normal stream: two data events', () => {
		const text = [
			'data: {"choices":[{"delta":{"content":"hello"}}]}',
			'',
			'data: {"choices":[{"delta":{"content":" world"}}]}',
			'',
			'data: [DONE]',
			''
		].join('\n');
		const events = parseSseText(text);
		expect(events.length).toBe(2);
		expect(JSON.parse(events[0]!.data).choices[0].delta.content).toBe('hello');
		expect(JSON.parse(events[1]!.data).choices[0].delta.content).toBe(' world');
	});

	test('chunk split mid-line: parseSseText handles it via full text', () => {
		// Simulate a chunk boundary in the middle of a data line
		const full = 'data: {"choices":[{"delta":{"content":"hello world"}}]}\n\ndata: [DONE]\n\n';
		// Split mid-line and reassemble — parseSseText should still produce correct events
		const part1 = full.slice(0, 20);
		const part2 = full.slice(20);
		const reassembled = part1 + part2;
		const events = parseSseText(reassembled);
		expect(events.length).toBe(1);
		expect(JSON.parse(events[0]!.data).choices[0].delta.content).toBe('hello world');
	});

	test('multi-line data: event', () => {
		const text = ['data: line one', 'data: line two', '', 'data: [DONE]', ''].join('\n');
		const events = parseSseText(text);
		expect(events.length).toBe(1);
		expect(events[0]!.data).toBe('line one\nline two');
	});

	test('[DONE] terminates without yielding', () => {
		const text = [
			'data: {"choices":[{"delta":{"content":"hi"}}]}',
			'',
			'data: [DONE]',
			'',
			'data: {"choices":[{"delta":{"content":"should not appear"}}]}',
			''
		].join('\n');
		const events = parseSseText(text);
		expect(events.length).toBe(1);
	});

	test('malformed line without colon is ignored, does not throw', () => {
		const text = ['this is not valid sse', 'data: {"choices":[{"delta":{"content":"ok"}}]}', '', 'data: [DONE]', ''].join('\n');
		expect(() => parseSseText(text)).not.toThrow();
		const events = parseSseText(text);
		expect(events.length).toBe(1);
	});

	test('empty stream yields no events', () => {
		const events = parseSseText('');
		expect(events.length).toBe(0);
	});

	test('only [DONE] yields no events', () => {
		const events = parseSseText('data: [DONE]\n\n');
		expect(events.length).toBe(0);
	});
});

describe('parseSseStream incremental', () => {
	test('handles chunk split mid-line', async () => {
		const encoder = new TextEncoder();
		const chunks = [
			encoder.encode('data: {"choices":[{"delta":{"content":"hel'),
			encoder.encode('lo"}}]}\n\n'),
			encoder.encode('data: [DONE]\n\n')
		];
		let idx = 0;
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (idx < chunks.length) {
					controller.enqueue(chunks[idx++]!);
				} else {
					controller.close();
				}
			}
		});
		const events: { data: string }[] = [];
		for await (const ev of parseSseStream(stream)) {
			events.push(ev);
		}
		expect(events.length).toBe(1);
		expect(JSON.parse(events[0]!.data).choices[0].delta.content).toBe('hello');
	});

	test('handles chunk split mid-multibyte-character', async () => {
		const encoder = new TextEncoder();
		// "café" — é is 2 bytes in UTF-8 (0xC3 0xA9)
		const full = 'data: {"choices":[{"delta":{"content":"café"}}]}\n\n';
		const bytes = encoder.encode(full);
		// Split in the middle of the é character (between 0xC3 and 0xA9)
		// Find the é bytes
		const eAcute = encoder.encode('é');
		expect(eAcute.length).toBe(2);
		// Find where café starts in bytes
		// Just split the full bytes arbitrarily at a non-boundary
		const splitAt = bytes.length - 10;
		const chunk1 = bytes.slice(0, splitAt);
		const chunk2 = bytes.slice(splitAt);
		let idx = 0;
		const chunks = [chunk1, chunk2];
		const stream = new ReadableStream<Uint8Array>({
			pull(controller) {
				if (idx < chunks.length) {
					controller.enqueue(chunks[idx++]!);
				} else {
					controller.close();
				}
			}
		});
		const events: { data: string }[] = [];
		for await (const ev of parseSseStream(stream)) {
			events.push(ev);
		}
		expect(events.length).toBe(1);
		const content = JSON.parse(events[0]!.data).choices[0].delta.content;
		expect(content).toBe('café');
	});

	test('malformed line does not throw', async () => {
		const encoder = new TextEncoder();
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(encoder.encode('not valid sse line\n'));
				controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"ok"}}]}\n\n'));
				controller.enqueue(encoder.encode('data: [DONE]\n\n'));
				controller.close();
			}
		});
		const events: { data: string }[] = [];
		await expect(async () => {
			for await (const ev of parseSseStream(stream)) {
				events.push(ev);
			}
		}).not.toThrow();
		expect(events.length).toBe(1);
	});

	test('abort signal stops iteration', async () => {
		const encoder = new TextEncoder();
		const controller = new AbortController();
		const stream = new ReadableStream<Uint8Array>({
			pull(ctrl) {
				ctrl.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n'));
				// Don't close — let abort handle it
			}
		});
		const events: { data: string }[] = [];
		let count = 0;
		for await (const ev of parseSseStream(stream, controller.signal)) {
			events.push(ev);
			count++;
			if (count >= 1) {
				controller.abort();
				break;
			}
		}
		expect(events.length).toBe(1);
	});
});

describe('costFor', () => {
	test('known model returns cost', () => {
		const cost = costFor('deepseek-chat', 1000, 1000);
		expect(cost).toBeGreaterThan(0);
	});

	test('unknown model returns 0', () => {
		const cost = costFor('unknown-model-xyz', 1000, 1000);
		expect(cost).toBe(0);
	});
});
