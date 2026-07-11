import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { closeSync, mkdtempSync, mkdirSync, openSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";

export type NotifyLevel = "info" | "warning" | "error";

export type Notification = {
	message: string;
	level: NotifyLevel;
};

export type RegisteredCommand = {
	description?: string;
	handler?: unknown;
};

export const KEY_UP = "\x1b[A";
export const KEY_DOWN = "\x1b[B";
export const KEY_LEFT = "\x1b[D";
export const KEY_HOME = "\x1b[H";
export const KEY_END = "\x1b[F";
export const KEY_ENTER = "\r";
export const KEY_ESCAPE = "\x1b";
export const KEY_BACKSPACE = "\x7f";
export const PREFERRED_BROWSER_START_PATH = join(homedir(), "Developper", "Projects");

export const testTheme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
	underline: (text: string) => text,
	inverse: (text: string) => text,
	strikethrough: (text: string) => text,
} as unknown as Theme;

export function createCommandContext(cwd: string) {
	const notifications: Notification[] = [];

	return {
		ctx: {
			cwd,
			ui: {
				notify: (message: string, level: NotifyLevel) => {
					notifications.push({ message, level });
				},
			},
		},
		notifications,
	};
}

export function createInteractiveCommandContext(cwd: string, customResults: Array<string | null>) {
	const base = createCommandContext(cwd);
	const customCalls: Array<{ overlay?: boolean }> = [];
	const renderedComponents: Component[] = [];

	return {
		ctx: {
			...base.ctx,
			ui: {
				...base.ctx.ui,
				custom: async <T,>(
					factory: (
						tui: { requestRender: () => void },
						theme: Theme,
						keybindings: unknown,
						done: (result: T) => void,
					) => Component | Promise<Component>,
					options?: { overlay?: boolean },
				): Promise<T> => {
					customCalls.push(options ?? {});
					const component = await factory({ requestRender: () => {} }, testTheme, {}, () => {});
					renderedComponents.push(component);
					return customResults.shift() as T;
				},
			},
		},
		notifications: base.notifications,
		customCalls,
		renderedComponents,
	};
}

export function createDirectoryFixture(): string {
	const root = mkdtempSync(join(tmpdir(), "pi-cwd-"));
	mkdirSync(join(root, "zeta"));
	mkdirSync(join(root, "alpha"));
	mkdirSync(join(root, ".hidden"));
	closeSync(openSync(join(root, "file.txt"), "w"));
	return root;
}
