/**
 * Null-safe helper for workerd SQLite cursors.
 *
 * workerd's cursor.one() THROWS on zero rows ("Expected exactly one result…"),
 * so `if (!row) return null` after .one() is dead code. This helper prefers
 * toArray()[0] ?? null (or iteration) and falls back to .one() with try/catch
 * so test stubs that only implement .one() still work.
 * 0 rows → null, 1 row → row, >1 rows → first row, never throws.
 */
export function oneOrNull<TRow>(cursor: Iterable<TRow> & { toArray?: () => TRow[]; one?: () => TRow | undefined }): TRow | null {
	if (typeof cursor.toArray === 'function') {
		const arr = cursor.toArray();
		if (arr.length > 0) return arr[0] as TRow;
		if (typeof cursor.one === 'function') {
			try {
				const v = cursor.one() as TRow | undefined;
				return (v ?? null) as TRow | null;
			} catch {
				return null;
			}
		}
		return null;
	}
	const arr = [...cursor];
	if (arr.length > 0) return arr[0] as TRow;
	if (typeof cursor.one === 'function') {
		try {
			const v = cursor.one() as TRow | undefined;
			return (v ?? null) as TRow | null;
		} catch {
			return null;
		}
	}
	return null;
}
