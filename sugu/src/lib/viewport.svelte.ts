/**
 * Viewport state — matchMedia-driven rune.
 * Single source of truth for desktop vs mobile layout.
 * Uses "(min-width: 64rem)" which is Tailwind's `lg` breakpoint (1024px).
 */
export class Viewport {
	isDesktop = $state(false);
	#mql: MediaQueryList | null = null;
	#handler: ((e: MediaQueryListEvent) => void) | null = null;

	constructor(query = '(min-width: 64rem)') {
		if (typeof window === 'undefined') return;
		this.#mql = window.matchMedia(query);
		this.isDesktop = this.#mql.matches;
		this.#handler = (e: MediaQueryListEvent) => {
			this.isDesktop = e.matches;
		};
		this.#mql.addEventListener('change', this.#handler);
	}

	destroy(): void {
		if (this.#mql && this.#handler) {
			this.#mql.removeEventListener('change', this.#handler);
			this.#handler = null;
		}
	}
}

export const viewport = new Viewport();

export class SidebarState {
	collapsed = $state(false);
	#key = 'sugu_sidebar_collapsed';

	constructor() {
		if (typeof window !== 'undefined') {
			try {
				const stored = localStorage.getItem(this.#key);
				if (stored === 'true') this.collapsed = true;
			} catch {
				// ignore
			}
		}
	}

	toggle(): void {
		this.collapsed = !this.collapsed;
		try {
			localStorage.setItem(this.#key, String(this.collapsed));
		} catch {
			// ignore
		}
	}
}

export const sidebarState = new SidebarState();
