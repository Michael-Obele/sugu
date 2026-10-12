/**
 * Rune-based store: token, session, frames, busy, connection state.
 */
import { applyFrame, initialFrameState, type FrameState } from './frames';
import { SuguSocket, type ConnectionState } from './socket';
import type { Frame } from '../../../src/shared/contracts';
import { getToken } from './api';

export class SessionStore {
	token = $state<string | null>(null);
	sessionId = $state<string | null>(null);
	frameState = $state<FrameState>(initialFrameState());
	connection = $state<ConnectionState>('closed');
	error = $state<string | null>(null);

	private socket: SuguSocket | null = null;
	private pendingText: string | null = null;

	busy = $derived(this.frameState.busy);
	messages = $derived(this.frameState.messages);
	tools = $derived(this.frameState.tools);

	constructor() {
		if (typeof localStorage !== 'undefined') {
			this.token = getToken();
		}
	}

	connect(sessionId: string, onOpen?: () => void, onBusyError?: (text: string) => void): void {
		const isNewSession = this.sessionId !== null && this.sessionId !== sessionId;
		if (isNewSession) {
			this.frameState = initialFrameState();
			this.error = null;
		}
		this.disconnect();
		this.sessionId = sessionId;
		const token = this.token ?? getToken();
		if (!token) {
			this.error = 'Not authenticated';
			this.connection = 'closed';
			return;
		}
		this.token = token;
		const since =
			this.frameState.messages.length > 0
				? Math.max(...this.frameState.messages.map((m) => m.seq))
				: 0;

		this.socket = new SuguSocket(sessionId, token, since, {
			onFrame: (frame: Frame) => {
				if (frame.t === 'err') {
					this.error = frame.message;
					if (frame.code === 'busy' && this.pendingText && onBusyError) {
						onBusyError(this.pendingText);
					}
					this.pendingText = null;
					return;
				}
				if (frame.t === 'msg' && frame.role === 'assistant' && !frame.interrupted) {
					this.pendingText = null;
				}
				this.frameState = applyFrame(this.frameState, frame);
			},
			onState: (state: ConnectionState) => {
				this.connection = state;
				if (state === 'open' && onOpen) onOpen();
			},
			onError: (message: string) => {
				this.error = message;
			}
		});
		this.socket.connect();
	}

	disconnect(): void {
		if (this.socket) {
			this.socket.close();
			this.socket = null;
		}
		this.connection = 'closed';
	}

	send(text: string): void {
		if (!text.trim()) return;
		if (this.connection !== 'open') {
			this.error = 'You are offline — message kept in composer';
			return;
		}
		this.pendingText = text;
		if (this.socket) {
			this.socket.sendText(text);
		}
	}

	cancel(): void {
		if (this.socket) this.socket.cancel();
	}

	reset(): void {
		this.disconnect();
		this.frameState = initialFrameState();
		this.sessionId = null;
		this.error = null;
	}
}

export const sessionStore = new SessionStore();
