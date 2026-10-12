/**
 * REST client. Attaches the bearer token, and on 401 clears it and reports
 * "logged out" so the app can route to /login and come back.
 */

export type ApiError = {
	status: number;
	message: string;
};

export type SessionMeta = {
	id: string;
	title: string;
	model: string;
	createdAt: string;
	updatedAt: string;
	lastSeq: number;
	archived: boolean;
};

let token: string | null = null;

function hasLocalStorage(): boolean {
	return typeof localStorage !== 'undefined';
}

export function setToken(t: string | null): void {
	token = t;
	if (!hasLocalStorage()) return;
	if (t) {
		try {
			localStorage.setItem('sugu_token', t);
		} catch {
			// ignore
		}
	} else {
		try {
			localStorage.removeItem('sugu_token');
		} catch {
			// ignore
		}
	}
}

export function getToken(): string | null {
	if (token) return token;
	if (!hasLocalStorage()) return token;
	try {
		const stored = localStorage.getItem('sugu_token');
		if (stored) token = stored;
	} catch {
		// ignore
	}
	return token;
}

export function loadToken(): string | null {
	return getToken();
}

let onUnauthorized: (() => void) | null = null;

export function setOnUnauthorized(cb: (() => void) | null): void {
	onUnauthorized = cb;
}

function authHeaders(): Record<string, string> {
	const t = getToken();
	if (t) return { Authorization: `Bearer ${t}` };
	return {};
}

async function handleResponse<T>(res: Response): Promise<T> {
	if (res.status === 401) {
		setToken(null);
		if (onUnauthorized) onUnauthorized();
		const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
		throw { status: 401, message: (body['error'] as string) || 'Unauthorized' } as ApiError;
	}
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
		const msg = (body['error'] as string) || `Request failed: ${res.status}`;
		throw { status: res.status, message: msg } as ApiError;
	}
	return (await res.json()) as T;
}

export async function login(passphrase: string): Promise<string> {
	const res = await fetch('/api/login', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ passphrase })
	});
	if (res.status === 401) {
		const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
		throw { status: 401, message: (body['error'] as string) || 'Wrong passphrase' } as ApiError;
	}
	if (res.status === 429) {
		throw { status: 429, message: 'Too many attempts, wait a few minutes' } as ApiError;
	}
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
		throw { status: res.status, message: (body['error'] as string) || 'Login failed' } as ApiError;
	}
	const data = (await res.json()) as { token: string };
	setToken(data.token);
	return data.token;
}

export async function listSessions(): Promise<SessionMeta[]> {
	const res = await fetch('/api/sessions', {
		headers: { ...authHeaders() }
	});
	return handleResponse<SessionMeta[]>(res);
}

export async function createSession(title?: string, model?: string): Promise<SessionMeta> {
	const res = await fetch('/api/sessions', {
		method: 'POST',
		headers: { 'content-type': 'application/json', ...authHeaders() },
		body: JSON.stringify({ title, model })
	});
	return handleResponse<SessionMeta>(res);
}

export function logout(): void {
	setToken(null);
}
