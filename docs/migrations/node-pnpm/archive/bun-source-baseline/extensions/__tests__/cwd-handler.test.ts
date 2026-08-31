import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { handleCwdCommand } from "../cwd-internals/handler";
import {
	createCommandContext,
	createInteractiveCommandContext,
	PREFERRED_BROWSER_START_PATH,
} from "./cwd-test-helpers";

describe("handleCwdCommand", () => {
	test("opens interactive mode when no args are provided", async () => {
		const root = "/tmp/root";
		const selectedDirectory = "/tmp/root/project";
		const { ctx, notifications, customCalls, renderedComponents } = createInteractiveCommandContext(root, [
			selectedDirectory,
			"--right",
		]);
		const executedCommands: string[][] = [];

		await handleCwdCommand("   ", ctx, {
			directoryExists: (candidate) =>
				candidate === selectedDirectory || candidate === PREFERRED_BROWSER_START_PATH,
			runWezTerm: (args) => {
				executedCommands.push(args);
			},
		});

		expect(customCalls).toEqual([{ overlay: true }, { overlay: true }]);
		expect(renderedComponents[0].render(160).some((line) => line.includes(PREFERRED_BROWSER_START_PATH))).toBe(true);
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
