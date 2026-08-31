/**
 * Node parity target for the cwd command handler.
 *
 * The retired source path was extensions/__tests__/cwd-handler.test.ts.
 */

import assert from "node:assert/strict";
import { join, resolve } from "node:path";
import { describe, test } from "node:test";
import { handleCwdCommand } from "../../cwd-internals/handler.ts";
import {
	createCommandContext,
	createInteractiveCommandContext,
	PREFERRED_BROWSER_START_PATH,
} from "../cwd-test-helpers.ts";

describe("handleCwdCommand", () => {
	test("opens interactive mode when no args are provided", async () => {
		const root = "/tmp/root";
		const selectedDirectory = "/tmp/root/project";
		const { ctx, notifications, customCalls, renderedComponents } =
			createInteractiveCommandContext(root, [selectedDirectory, "--right"]);
		const executedCommands: string[][] = [];

		await handleCwdCommand("   ", ctx, {
			directoryExists: (candidate) =>
				candidate === selectedDirectory ||
				candidate === PREFERRED_BROWSER_START_PATH,
			runWezTerm: (args) => {
				executedCommands.push(args);
			},
		});

		assert.deepStrictEqual(customCalls, [{ overlay: true }, { overlay: true }]);
		assert.strictEqual(
			renderedComponents[0]
				.render(160)
				.some((line) => line.includes(PREFERRED_BROWSER_START_PATH)),
			true,
		);
		assert.deepStrictEqual(executedCommands, [
			["cli", "split-pane", "--right", "--cwd", selectedDirectory, "--", "pi"],
		]);
		assert.deepStrictEqual(notifications, [
			{
				message: `Pi opened in split pane: ${selectedDirectory}`,
				level: "info",
			},
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

		assert.strictEqual(executedCommands.length, 1);
		assert.deepStrictEqual(executedCommands[0], [
			"cli",
			"split-pane",
			"--right",
			"--cwd",
			directory,
			"--",
			"pi",
		]);
		assert.deepStrictEqual(notifications, [
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

		assert.strictEqual(executed, false);
		assert.deepStrictEqual(notifications, [
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

		assert.strictEqual(checkedDirectory, false);
		assert.deepStrictEqual(notifications, [
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

		assert.deepStrictEqual(notifications, [
			{
				message: "wezterm CLI not available. Are you inside WezTerm?",
				level: "error",
			},
		]);
	});
});
