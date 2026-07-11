import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import cwdExtension, { buildWezTermArgs, handleCwdCommand, parseCwdArgs } from "../cwd";

type NotifyLevel = "info" | "warning" | "error";

type Notification = {
	message: string;
	level: NotifyLevel;
};

type RegisteredCommand = {
	description?: string;
	handler?: unknown;
};

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
