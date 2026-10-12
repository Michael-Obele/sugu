/**
 * WebSocket wrapper: connect with the token, send hello { sessionId, token, since },
 * decode with the Valibot schema, re-hello after reconnect.
 */

import { parseFrame } from '../../../src/shared/contracts';
import type { Frame } from '../../../src/shared/contracts';
import { Backoff } from './backoff';

export type ConnectionState = 'connecting' | 'open' | 'reconnecting' | 'closed';

export type SocketEvents = {
	onFrame: (frame: Frame) => void;
	onState: (state: ConnectionState) => void;
	onError: (message: string) => void;
};

export class SuguSocket {
	private ws: WebSocket | null = null;
	private sessionId: string;
	private token: string;
	private since: number;
	private events: SocketEvents;
	private closed = false;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private backoff = new Backoff();

	constructor(sessionId: string, token: string, since: number, events: SocketEvents) {
		this.sessionId = sessionId;
		this.token = token;
		this.since = since;
		this.events = events;
	}

	connect(): void {
		if (this.closed) return;
		this.events.onState('connecting');
		const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
		const url = `${proto}//${location.host}/ws?sessionId=${encodeURIComponent(this.sessionId)}&token=${encodeURIComponent(this.token)}`;
		const ws = new WebSocket(url);
		this.ws = ws;

		ws.addEventListener('open', () => {
			this.backoff.reset();
			this.events.onState('open');
			const hello: Record<string, unknown> = {
				v: 1,
				t: 'hello',
				sessionId: this.sessionId,
				token: this.token
			};
			if (this.since > 0) hello['since'] = this.since;
			ws.send(JSON.stringify(hello));
		});

		ws.addEventListener('message', (event) => {
			let raw: unknown;
			try {
				raw = JSON.parse(event.data as string);
			} catch {
				this.events.onError('invalid JSON');
				return;
			}
			const parsed = parseFrame(raw);
			if (!parsed.ok) {
				// Unknown frame must be ignored and surfaced, never crash
				this.events.onError('unknown frame');
				return;
			}
			const frame = parsed.frame;
			// Track since for resume: any frame with seq updates since
			if ('seq' in frame && typeof (frame as Record<string, unknown>)['seq'] === 'number') {
				const seq = (frame as unknown as { seq: number }).seq;
				if (seq > this.since) this.since = seq;
			}
			this.events.onFrame(frame);
		});

		ws.addEventListener('close', () => {
			if (this.closed) {
				this.events.onState('closed');
				return;
			}
			this.events.onState('reconnecting');
			this.scheduleReconnect();
		});

		ws.addEventListener('error', () => {
			// error will be followed by close
		});
	}

	private scheduleReconnect(): void {
		if (this.closed) return;
		const delay = this.backoff.next();
		this.reconnectTimer = setTimeout(() => {
			this.connect();
		}, delay);
	}

	send(frame: Record<string, unknown>): void {
		if (this.ws && this.ws.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(frame));
		}
	}

	sendText(text: string): void {
		this.send({ v: 1, t: 'send', text });
	}

	cancel(): void {
		this.send({ v: 1, t: 'cancel' });
	}

	ack(seq: number, to: number): void {
		this.send({ v: 1, t: 'ack', seq, to });
	}

	updateSince(since: number): void {
		if (since > this.since) this.since = since;
	}

	close(): void {
		this.closed = true;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		if (this.ws) {
			try {
				this.ws.close();
			} catch {
				// ignore
			}
		}
		this.events.onState('closed');
	}

	get state(): ConnectionState {
		if (this.closed) return 'closed';
		if (!this.ws) return 'connecting';
		switch (this.ws.readyState) {
			case WebSocket.CONNECTING:
				return 'connecting';
			case WebSocket.OPEN:
				return 'open';
			case WebSocket.CLOSING:
			case WebSocket.CLOSED:
				return 'reconnecting';
			default:
				return 'connecting';
		}
	}
}
