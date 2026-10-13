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

export type ModelInfo = {
	id: string;
	label: string;
	provider: 'deepseek' | 'openrouter';
	contextLength?: number;
	price?: { promptPerM: number; completionPerM: number };
	priceKnown: boolean;
};

export type ModelsResponse = {
	models: ModelInfo[];
	source: 'live' | 'cache' | 'fallback';
	fetchedAt: string;
};

export type EventsPage = {
	frames: unknown[];
	hasMore: boolean;
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

export async function patchSession(
	id: string,
	patch: { title?: string; model?: string }
): Promise<SessionMeta> {
	const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
		method: 'PATCH',
		headers: { 'content-type': 'application/json', ...authHeaders() },
		body: JSON.stringify(patch)
	});
	return handleResponse<SessionMeta>(res);
}

export async function deleteSession(id: string): Promise<{ ok: boolean }> {
	const res = await fetch(`/api/sessions/${encodeURIComponent(id)}`, {
		method: 'DELETE',
		headers: { ...authHeaders() }
	});
	return handleResponse<{ ok: boolean }>(res);
}

export async function getModels(): Promise<ModelsResponse> {
	const res = await fetch('/api/models', {
		headers: { ...authHeaders() }
	});
	return handleResponse<ModelsResponse>(res);
}

export async function getEventsPage(
	id: string,
	opts?: { before?: number; limit?: number }
): Promise<EventsPage> {
	const params = new URLSearchParams();
	if (opts?.before !== undefined) params.set('before', String(opts.before));
	if (opts?.limit !== undefined) params.set('limit', String(opts.limit));
	const qs = params.toString() ? `?${params.toString()}` : '';
	const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/events${qs}`, {
		headers: { ...authHeaders() }
	});
	return handleResponse<EventsPage>(res);
}

export async function exportSession(id: string): Promise<string> {
	const res = await fetch(`/api/sessions/${encodeURIComponent(id)}/export`, {
		headers: { ...authHeaders() }
	});
	if (res.status === 401) {
		setToken(null);
		if (onUnauthorized) onUnauthorized();
		throw { status: 401, message: 'Unauthorized' } as ApiError;
	}
	if (!res.ok) {
		const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
		throw {
			status: res.status,
			message: (body['error'] as string) || `Export failed: ${res.status}`
		} as ApiError;
	}
	return await res.text();
}

export function downloadJsonl(filename: string, text: string): void {
	const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	a.download = filename;
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

export async function getQuota(): Promise<{
	day: string;
	turns: number;
	prompt_t: number;
	compl_t: number;
	cost_usd: number;
	tools: number;
}> {
	const res = await fetch('/api/quota', {
		headers: { ...authHeaders() }
	});
	return handleResponse(res);
}

export type SkillInfo = {
	name: string;
	description: string;
	source: string;
	path: string;
};

export type SkillsResponse = {
	skills: SkillInfo[];
	configured: boolean;
	fetchedAt: string;
	error?: string;
};

export async function getSkills(): Promise<SkillsResponse> {
	const res = await fetch('/api/skills', {
		headers: { ...authHeaders() }
	});
	return handleResponse<SkillsResponse>(res);
}

export function logout(): void {
	setToken(null);
}
