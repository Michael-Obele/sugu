/**
 * Shared session-list store — single source of truth for session state.
 * The shell, `/` and `/s/[id]` all consume this.
 */
import { goto } from '$app/navigation';
import {
	listSessions,
	createSession,
	deleteSession,
	patchSession,
	exportSession,
	downloadJsonl,
	getModels
} from '$lib/api';
import type { SessionMeta, ModelInfo } from '$lib/api';

export class SessionsStore {
	sessions = $state<SessionMeta[]>([]);
	loading = $state(true);
	error = $state<string | null>(null);

	// New session creation state
	creating = $state(false);
	newTitle = $state('');
	newModel = $state('deepseek-chat');
	models = $state<ModelInfo[]>([]);
	modelsSource = $state('fallback');
	modelsLoading = $state(false);

	// Dialog state — single instance for the whole app
	renameOpen = $state(false);
	renameId: string | null = $state(null);
	renameValue = $state('');
	renameError: string | null = $state(null);
	renameSaving = $state(false);

	deleteOpen = $state(false);
	deleteId: string | null = $state(null);
	deleteSaving = $state(false);

	exportError: string | null = $state(null);

	// Sheet state
	sheetOpen = $state(false);
	historySheetOpen = $state(false);

	async load(): Promise<boolean> {
		this.loading = true;
		try {
			const list = await listSessions();
			list.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
			this.sessions = list;
			this.error = null;
			return true;
		} catch (e) {
			const err = e as { status?: number; message?: string };
			if (err.status === 401) {
				goto('/login');
				return false;
			}
			this.error = err.message ?? 'Failed to load sessions';
			return false;
		} finally {
			this.loading = false;
		}
	}

	async loadModels(): Promise<void> {
		this.modelsLoading = true;
		try {
			const res = await getModels();
			this.models = res.models;
			this.modelsSource = res.source;
			if (res.defaultModel) this.newModel = res.defaultModel;
		} catch {
			// keep fallback
		} finally {
			this.modelsLoading = false;
		}
	}

	async create(): Promise<SessionMeta | null> {
		if (this.creating) return null;
		this.creating = true;
		this.error = null;
		try {
			const title = this.newTitle.trim() || undefined;
			const session = await createSession(title, this.newModel);
			this.sheetOpen = false;
			this.newTitle = '';
			await this.load();
			return session;
		} catch (e) {
			const err = e as { message?: string };
			this.error = err.message ?? 'Failed to create session';
			return null;
		} finally {
			this.creating = false;
		}
	}

	openRename(id: string, currentTitle: string): void {
		this.renameId = id;
		this.renameValue = currentTitle;
		this.renameError = null;
		this.renameOpen = true;
	}

	openDelete(id: string): void {
		this.deleteId = id;
		this.deleteOpen = true;
	}

	async handleRename(): Promise<void> {
		if (!this.renameId) return;
		const trimmed = this.renameValue.trim();
		if (!trimmed) {
			this.renameError = 'Title cannot be empty';
			return;
		}
		if (trimmed.length > 60) {
			this.renameError = 'Title must be 60 characters or less';
			return;
		}
		this.renameSaving = true;
		this.renameError = null;
		try {
			await patchSession(this.renameId, { title: trimmed });
			this.renameOpen = false;
			this.renameId = null;
			await this.load();
		} catch (e) {
			const err = e as { message?: string };
			this.renameError = err.message ?? 'Rename failed';
		} finally {
			this.renameSaving = false;
		}
	}

	async handleDelete(onDeleted?: (deletedId: string) => void): Promise<void> {
		if (!this.deleteId) return;
		const deletedId = this.deleteId;
		this.deleteSaving = true;
		try {
			await deleteSession(deletedId);
			this.deleteOpen = false;
			this.deleteId = null;
			await this.load();
			onDeleted?.(deletedId);
		} catch {
			this.deleteOpen = false;
			await this.load();
			onDeleted?.(deletedId);
		} finally {
			this.deleteSaving = false;
		}
	}

	async handleExport(id: string): Promise<void> {
		this.exportError = null;
		try {
			const text = await exportSession(id);
			downloadJsonl(`${id}.jsonl`, text);
		} catch (e) {
			const err = e as { message?: string };
			this.exportError = err.message ?? 'Export failed';
		}
	}

	handleSheetOpenChange(open: boolean): void {
		this.sheetOpen = open;
		if (open) void this.loadModels();
	}
}

export const sessionsStore = new SessionsStore();
