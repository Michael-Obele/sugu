import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}

// Shared trigger class for ModelPicker and settings Select — single source of truth (C3).
// !bg-card overrides the Button variant's bg so the control is opaque (oklch 0.18) in
// both light and dark; without ! the variant's bg-transparent would win.
export const SELECT_TRIGGER_CLASS =
	'h-11 min-h-11 w-full justify-between rounded-md border !bg-card px-3 py-2 text-sm font-normal dark:!bg-card';

export type WithElementRef<T, U extends HTMLElement = HTMLElement> = T & {
	ref?: U | null;
};

export type WithoutChild<T> = T extends { child?: unknown } ? Omit<T, 'child'> : T;
export type WithoutChildren<T> = T extends { children?: unknown } ? Omit<T, 'children'> : T;
export type WithoutChildrenOrChild<T> = WithoutChildren<WithoutChild<T>>;
