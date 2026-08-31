/**
 * Node parity target for interactive cwd selection.
 *
 * The retired source path was extensions/__tests__/cwd-interactive.test.ts.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { interactiveCwd } from "../../cwd-internals/interactive.ts";
import { createInteractiveCommandContext } from "../cwd-test-helpers.ts";

describe("interactiveCwd", () => {
	test("runs WezTerm after directory and split type overlays complete", async () => {
		const selectedDirectory = "/tmp/root/project";
		const { ctx, notifications, customCalls } = createInteractiveCommandContext(
			"/tmp/root",
			[selectedDirectory, "--tab"],
		);
		const executedCommands: string[][] = [];

		await interactiveCwd(ctx, {
			directoryExists: (candidate) => candidate === selectedDirectory,
			runWezTerm: (args) => {
				executedCommands.push(args);
			},
		});

		assert.deepStrictEqual(customCalls, [{ overlay: true }, { overlay: true }]);
		assert.deepStrictEqual(executedCommands, [
			["cli", "spawn", "--cwd", selectedDirectory, "--", "pi"],
		]);
		assert.deepStrictEqual(notifications, [
			{
				message: `Pi opened in split pane: ${selectedDirectory}`,
				level: "info",
			},
		]);
	});

	test("does not run WezTerm when directory selection is cancelled", async () => {
		const { ctx, customCalls } = createInteractiveCommandContext("/tmp/root", [
			null,
		]);
		let executed = false;

		await interactiveCwd(ctx, {
			directoryExists: () => true,
			runWezTerm: () => {
				executed = true;
			},
		});

		assert.deepStrictEqual(customCalls, [{ overlay: true }]);
		assert.strictEqual(executed, false);
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

		assert.deepStrictEqual(customCalls, [{ overlay: true }, { overlay: true }]);
		assert.strictEqual(executed, false);
	});
});
