export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
	return new Response(JSON.stringify(data), {
		status,
		headers: { 'content-type': 'application/json; charset=utf-8', ...headers },
	});
}

export function errorJson(message: string, status: number): Response {
	return json({ error: message }, status);
}

export function parseBearer(request: Request): string | null {
	const h = request.headers.get('Authorization') ?? request.headers.get('authorization');
	if (!h) return null;
	const m = h.match(/^Bearer\s+(.+)$/i);
	if (!m) return null;
	const token = m[1]!.trim();
	return token || null;
}

export function unauthorized(message = 'Unauthorized'): Response {
	return errorJson(message, 401);
}

export function badRequest(message = 'Bad request'): Response {
	return errorJson(message, 400);
}
