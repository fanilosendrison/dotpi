import { describe, expect, test } from "bun:test";
import { interactiveCwd } from "../cwd-internals/interactive";
import { createInteractiveCommandContext } from "./cwd-test-helpers";

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
