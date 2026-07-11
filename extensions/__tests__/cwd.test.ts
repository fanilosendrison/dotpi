import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { describe, expect, test } from "bun:test";
import { closeSync, mkdtempSync, mkdirSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import cwdExtension, {
	buildWezTermArgs,
	DirectoryBrowser,
	handleCwdCommand,
	interactiveCwd,
	parseCwdArgs,
} from "../cwd";

type NotifyLevel = "info" | "warning" | "error";

type Notification = {
	message: string;
	level: NotifyLevel;
};

type RegisteredCommand = {
	description?: string;
	handler?: unknown;
};

const KEY_UP = "\x1b[A";
const KEY_DOWN = "\x1b[B";
const KEY_LEFT = "\x1b[D";
const KEY_HOME = "\x1b[H";
const KEY_END = "\x1b[F";
const KEY_ENTER = "\r";
const KEY_ESCAPE = "\x1b";
const KEY_BACKSPACE = "\x7f";

const testTheme = {
	fg: (_color: string, text: string) => text,
	bg: (_color: string, text: string) => text,
	bold: (text: string) => text,
	italic: (text: string) => text,
	underline: (text: string) => text,
	inverse: (text: string) => text,
	strikethrough: (text: string) => text,
} as unknown as Theme;

function createCommandContext(cwd: string) {
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

function createInteractiveCommandContext(cwd: string, customResults: Array<string | null>) {
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

function createDirectoryFixture(): string {
	const root = mkdtempSync(join(tmpdir(), "pi-cwd-"));
	mkdirSync(join(root, "zeta"));
	mkdirSync(join(root, "alpha"));
	mkdirSync(join(root, ".hidden"));
	closeSync(openSync(join(root, "file.txt"), "w"));
	return root;
}

describe("parseCwdArgs", () => {
	test("defaults to bottom split in the current directory", () => {
		expect(parseCwdArgs("")).toEqual({
			ok: true,
			splitType: "--bottom",
			directoryArgument: ".",
		});
	});

	test("accepts the split flag before the directory", () => {
		expect(parseCwdArgs("--right ../project")).toEqual({
			ok: true,
			splitType: "--right",
			directoryArgument: "../project",
		});
	});

	test("accepts the split flag after the directory", () => {
		expect(parseCwdArgs("../project --left")).toEqual({
			ok: true,
			splitType: "--left",
			directoryArgument: "../project",
		});
	});

	test("keeps unquoted paths with spaces as a single directory argument", () => {
		expect(parseCwdArgs("my project --tab")).toEqual({
			ok: true,
			splitType: "--tab",
			directoryArgument: "my project",
		});
	});

	test("keeps quoted paths with spaces as a single directory argument", () => {
		expect(parseCwdArgs('--top "my project"')).toEqual({
			ok: true,
			splitType: "--top",
			directoryArgument: "my project",
		});
	});

	test("rejects invalid split flags", () => {
		expect(parseCwdArgs("--diagonal .")).toEqual({
			ok: false,
			message:
				"Invalid split type. Use: --bottom, --top, --right, --left, --horizontal, --vertical, --tab",
		});
	});
});

describe("buildWezTermArgs", () => {
	for (const splitType of [
		"--bottom",
		"--top",
		"--right",
		"--left",
		"--horizontal",
	] as const) {
		test(`builds split-pane args for ${splitType}`, () => {
			expect(buildWezTermArgs(splitType, "/tmp/project")).toEqual([
				"cli",
				"split-pane",
				splitType,
				"--cwd",
				"/tmp/project",
				"--",
				"pi",
			]);
		});
	}

	test("translates vertical to bottom for the current WezTerm CLI", () => {
		expect(buildWezTermArgs("--vertical", "/tmp/project")).toEqual([
			"cli",
			"split-pane",
			"--bottom",
			"--cwd",
			"/tmp/project",
			"--",
			"pi",
		]);
	});

	test("builds spawn args for tabs", () => {
		expect(buildWezTermArgs("--tab", "/tmp/project")).toEqual([
			"cli",
			"spawn",
			"--cwd",
			"/tmp/project",
			"--",
			"pi",
		]);
	});
});

describe("handleCwdCommand", () => {
	test("opens interactive mode when no args are provided", async () => {
		const root = "/tmp/root";
		const selectedDirectory = "/tmp/root/project";
		const { ctx, notifications, customCalls } = createInteractiveCommandContext(root, [
			selectedDirectory,
			"--right",
		]);
		const executedCommands: string[][] = [];

		await handleCwdCommand("   ", ctx, {
			directoryExists: (candidate) => candidate === selectedDirectory,
			runWezTerm: (args) => {
				executedCommands.push(args);
			},
		});

		expect(customCalls).toEqual([{ overlay: true }, { overlay: true }]);
		expect(executedCommands).toEqual([
			["cli", "split-pane", "--right", "--cwd", selectedDirectory, "--", "pi"],
		]);
		expect(notifications).toEqual([
			{ message: `Pi opened in split pane: ${selectedDirectory}`, level: "info" },
		]);
	});

	test("executes WezTerm with the resolved directory and reports success", async () => {
		const root = "/tmp/root";
		const directory = resolve(root, "../target");
		const { ctx, notifications } = createCommandContext(root);
		const executedCommands: string[][] = [];

		await handleCwdCommand("--right ../target", ctx, {
			directoryExists: (candidate) => candidate === directory,
			runWezTerm: (args) => {
				executedCommands.push(args);
			},
		});

		expect(executedCommands).toHaveLength(1);
		expect(executedCommands[0]).toEqual([
			"cli",
			"split-pane",
			"--right",
			"--cwd",
			directory,
			"--",
			"pi",
		]);
		expect(notifications).toEqual([
			{ message: `Pi opened in split pane: ${directory}`, level: "info" },
		]);
	});

	test("reports missing directories before executing WezTerm", async () => {
		const root = "/tmp/root";
		const directory = join(root, "missing");
		const { ctx, notifications } = createCommandContext(root);
		let executed = false;

		await handleCwdCommand("missing", ctx, {
			directoryExists: () => false,
			runWezTerm: () => {
				executed = true;
			},
		});

		expect(executed).toBe(false);
		expect(notifications).toEqual([
			{ message: `Directory not found: ${directory}`, level: "error" },
		]);
	});

	test("reports invalid flags before resolving the directory", async () => {
		const { ctx, notifications } = createCommandContext("/tmp/root");
		let checkedDirectory = false;

		await handleCwdCommand("--diagonal .", ctx, {
			directoryExists: () => {
				checkedDirectory = true;
				return true;
			},
			runWezTerm: () => {},
		});

		expect(checkedDirectory).toBe(false);
		expect(notifications).toEqual([
			{
				message:
					"Invalid split type. Use: --bottom, --top, --right, --left, --horizontal, --vertical, --tab",
				level: "error",
			},
		]);
	});

	test("reports WezTerm execution failures", async () => {
		const { ctx, notifications } = createCommandContext("/tmp/root");

		await handleCwdCommand(".", ctx, {
			directoryExists: () => true,
			runWezTerm: () => {
				throw new Error("wezterm failed");
			},
		});

		expect(notifications).toEqual([
			{
				message: "wezterm CLI not available. Are you inside WezTerm?",
				level: "error",
			},
		]);
	});
});

describe("DirectoryBrowser", () => {
	test("initializes at an absolute path and lists sorted visible directories only", () => {
		const root = createDirectoryFixture();
		const browser = new DirectoryBrowser(root, testTheme);

		expect(browser.getCurrentPath()).toBe(root);
		expect(browser.getEntryNames()).toEqual(["alpha", "zeta"]);
	});

	test("moves selection with up and down keys", () => {
		const browser = new DirectoryBrowser(createDirectoryFixture(), testTheme);

		expect(browser.getSelectedIndex()).toBe(0);
		browser.handleInput(KEY_DOWN);
		expect(browser.getSelectedIndex()).toBe(1);
		browser.handleInput(KEY_DOWN);
		expect(browser.getSelectedIndex()).toBe(2);
		browser.handleInput(KEY_DOWN);
		expect(browser.getSelectedIndex()).toBe(3);
		browser.handleInput(KEY_DOWN);
		expect(browser.getSelectedIndex()).toBe(3);
		browser.handleInput(KEY_UP);
		expect(browser.getSelectedIndex()).toBe(2);
	});

	test("home and end jump to first and last selectable items", () => {
		const browser = new DirectoryBrowser(createDirectoryFixture(), testTheme);

		browser.handleInput(KEY_END);
		expect(browser.getSelectedIndex()).toBe(3);
		browser.handleInput(KEY_HOME);
		expect(browser.getSelectedIndex()).toBe(0);
	});

	test("enter on use-this-directory selects the current path", () => {
		const root = createDirectoryFixture();
		const browser = new DirectoryBrowser(root, testTheme);
		const selectedPaths: string[] = [];
		browser.onSelect = (path) => {
			selectedPaths.push(path);
		};

		browser.handleInput(KEY_ENTER);

		expect(selectedPaths).toEqual([root]);
	});

	test("enter on a subdirectory updates the current path", () => {
		const root = createDirectoryFixture();
		const browser = new DirectoryBrowser(root, testTheme);

		browser.handleInput(KEY_DOWN);
		browser.handleInput(KEY_DOWN);
		browser.handleInput(KEY_ENTER);

		expect(browser.getCurrentPath()).toBe(join(root, "alpha"));
		expect(browser.getSelectedIndex()).toBe(0);
	});

	test("backspace and left go to the parent directory", () => {
		const root = createDirectoryFixture();
		const browser = new DirectoryBrowser(join(root, "alpha"), testTheme);

		browser.handleInput(KEY_BACKSPACE);
		expect(browser.getCurrentPath()).toBe(root);

		browser.handleInput(KEY_DOWN);
		browser.handleInput(KEY_DOWN);
		browser.handleInput(KEY_ENTER);
		expect(browser.getCurrentPath()).toBe(join(root, "alpha"));

		browser.handleInput(KEY_LEFT);
		expect(browser.getCurrentPath()).toBe(root);
	});

	test("escape cancels the browser", () => {
		const browser = new DirectoryBrowser(createDirectoryFixture(), testTheme);
		let cancelled = false;
		browser.onCancel = () => {
			cancelled = true;
		};

		browser.handleInput(KEY_ESCAPE);

		expect(cancelled).toBe(true);
	});

	test("does not render a parent entry at filesystem root", () => {
		const browser = new DirectoryBrowser("/", testTheme);

		expect(browser.render(80).some((line) => line.includes(".."))).toBe(false);
	});

	test("caches render output and invalidates on state changes", () => {
		const browser = new DirectoryBrowser(createDirectoryFixture(), testTheme);

		const firstRender = browser.render(80);
		expect(browser.render(80)).toBe(firstRender);
		browser.handleInput(KEY_DOWN);
		expect(browser.render(80)).not.toBe(firstRender);
	});
});

describe("interactiveCwd", () => {
	test("runs WezTerm after directory and split type overlays complete", async () => {
		const selectedDirectory = "/tmp/root/project";
		const { ctx, notifications, customCalls } = createInteractiveCommandContext("/tmp/root", [
			selectedDirectory,
			"--tab",
		]);
		const executedCommands: string[][] = [];

		await interactiveCwd(ctx, {
			directoryExists: (candidate) => candidate === selectedDirectory,
			runWezTerm: (args) => {
				executedCommands.push(args);
			},
		});

		expect(customCalls).toEqual([{ overlay: true }, { overlay: true }]);
		expect(executedCommands).toEqual([["cli", "spawn", "--cwd", selectedDirectory, "--", "pi"]]);
		expect(notifications).toEqual([
			{ message: `Pi opened in split pane: ${selectedDirectory}`, level: "info" },
		]);
	});

	test("does not run WezTerm when directory selection is cancelled", async () => {
		const { ctx, customCalls } = createInteractiveCommandContext("/tmp/root", [null]);
		let executed = false;

		await interactiveCwd(ctx, {
			directoryExists: () => true,
			runWezTerm: () => {
				executed = true;
			},
		});

		expect(customCalls).toEqual([{ overlay: true }]);
		expect(executed).toBe(false);
	});

	test("does not run WezTerm when split type selection is cancelled", async () => {
		const { ctx, customCalls } = createInteractiveCommandContext("/tmp/root", [
			"/tmp/root/project",
			null,
		]);
		let executed = false;

		await interactiveCwd(ctx, {
			directoryExists: () => true,
			runWezTerm: () => {
				executed = true;
			},
		});

		expect(customCalls).toEqual([{ overlay: true }, { overlay: true }]);
		expect(executed).toBe(false);
	});
});

describe("cwd extension", () => {
	test("registers the /cwd command", () => {
		const registeredCommands: Array<{ name: string; command: RegisteredCommand }> = [];
		const piMock = {
			registerCommand: (name: string, command: RegisteredCommand) => {
				registeredCommands.push({ name, command });
			},
		};

		cwdExtension(piMock as unknown as ExtensionAPI);

		expect(registeredCommands).toHaveLength(1);
		const registeredCommand = registeredCommands[0];
		expect(registeredCommand.name).toBe("cwd");
		expect(registeredCommand.command.description).toContain("WezTerm");
		expect(registeredCommand.command.handler).toBeFunction();
	});
});
