import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { importPiExtension } from "./pi-extension-loader.node.ts";

type ExtensionHandler = (...args: unknown[]) => Promise<unknown> | unknown;

type ExtensionFactory = (pi: {
	on: (event: string, handler: ExtensionHandler) => void;
}) => void;

interface TelemetryEvent {
	eventType: string;
	details: Record<string, unknown>;
}

describe("path-guard Pi extension integration", () => {
	let tmpDir: string;
	let originalTelemetryBaseDir: string | undefined;
	let handlers: Record<string, ExtensionHandler[]>;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "path-guard-"));
		originalTelemetryBaseDir = process.env.PI_TELEMETRY_BASE_DIR;
		process.env.PI_TELEMETRY_BASE_DIR = tmpDir;
		handlers = {};

		const pathGuardExt =
			await importPiExtension<ExtensionFactory>("path-guard.ts");
		pathGuardExt({
			on: (event, handler) => {
				handlers[event] = [...(handlers[event] ?? []), handler];
			},
		});

		await trigger("before_provider_request", {
			payload: { model: "test-model-pathguard" },
		});
		await trigger("thinking_level_select", { level: "low" });
	});

	afterEach(() => {
		if (originalTelemetryBaseDir === undefined) {
			delete process.env.PI_TELEMETRY_BASE_DIR;
		} else {
			process.env.PI_TELEMETRY_BASE_DIR = originalTelemetryBaseDir;
		}
		if (existsSync(tmpDir)) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	async function trigger(event: string, ...args: unknown[]): Promise<unknown> {
		let lastResult: unknown;
		for (const handler of handlers[event] ?? []) {
			lastResult = await handler(...args);
		}
		return lastResult;
	}

	function readEvents(): TelemetryEvent[] {
		const eventsPath = join(tmpDir, "path-guard", "events.jsonl");
		if (!existsSync(eventsPath)) return [];
		return readFileSync(eventsPath, "utf-8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as TelemetryEvent);
	}

	test("registers tool_call handlers and rewrites paths silently with telemetry", async () => {
		assert.strictEqual(handlers.tool_call.length, 2);
		const HOME = process.env.HOME || "/Users/famillesendrison";

		const safeWriteEvent = {
			toolName: "write",
			input: { path: `${HOME}/.pi/agent/settings.json`, content: "" },
		};
		await trigger("tool_call", safeWriteEvent, {});
		assert.strictEqual(
			safeWriteEvent.input.path,
			`${HOME}/.pi/agent/settings.json`,
		);

		let events = readEvents();
		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0].eventType, "path_access");
		assert.partialDeepStrictEqual(events[0].details, {
			toolType: "write",
			repo: "dotpi",
			action: "correct",
			givenPath: `${HOME}/.pi/agent/settings.json`,
			parentModel: "test-model-pathguard",
			thinkingLevel: "low",
		});

		const unsafeWriteEvent = {
			toolName: "write",
			input: {
				path: `${HOME}/Developper/Projects/dotpi/settings.json`,
				content: "",
			},
		};
		await trigger("tool_call", unsafeWriteEvent, {});
		assert.strictEqual(
			unsafeWriteEvent.input.path,
			`${HOME}/.pi/agent/settings.json`,
		);

		events = readEvents();
		assert.strictEqual(events.length, 2);
		assert.strictEqual(events[1].eventType, "path_access");
		assert.partialDeepStrictEqual(events[1].details, {
			toolType: "write",
			repo: "dotpi",
			action: "redirected",
			givenPath: `${HOME}/Developper/Projects/dotpi/settings.json`,
			rewrittenTo: `${HOME}/.pi/agent/settings.json`,
			parentModel: "test-model-pathguard",
			thinkingLevel: "low",
		});

		const safeBashEvent = {
			toolName: "bash",
			input: { command: "ls -la" },
		};
		await trigger("tool_call", safeBashEvent, {});
		assert.strictEqual(safeBashEvent.input.command, "ls -la");
		assert.strictEqual(readEvents().length, 2);

		const unsafeBashEvent = {
			toolName: "bash",
			input: {
				command: `echo 'hello' > ${HOME}/Developper/Projects/dotpi/settings.json`,
			},
		};
		await trigger("tool_call", unsafeBashEvent, {});
		assert.ok(unsafeBashEvent.input.command.includes("settings.json"));
		assert.ok(unsafeBashEvent.input.command.includes("Silent redirection to"));
		assert.ok(
			unsafeBashEvent.input.command.includes(`${HOME}/.pi/agent/settings.json`),
		);

		events = readEvents();
		assert.strictEqual(events.length, 3);
		assert.strictEqual(events[2].eventType, "path_access");
		assert.partialDeepStrictEqual(events[2].details, {
			toolType: "bash",
			repo: "dotpi",
			action: "redirected",
			givenPath: `${HOME}/Developper/Projects/dotpi/settings.json`,
			parentModel: "test-model-pathguard",
			thinkingLevel: "low",
		});
	});
});
