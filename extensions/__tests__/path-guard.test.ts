import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importPiExtension } from "./pi-extension-loader";

type ExtensionFactory = (pi: {
	on: (event: string, cb: Function) => void;
}) => void;

interface TelemetryEvent {
	eventType: string;
	details: Record<string, unknown>;
}

describe("path-guard Pi extension integration", () => {
	let tmpDir: string;
	let originalTelemetryBaseDir: string | undefined;
	let handlers: Record<string, Function[]>;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "path-guard-"));
		originalTelemetryBaseDir = process.env.PI_TELEMETRY_BASE_DIR;
		process.env.PI_TELEMETRY_BASE_DIR = tmpDir;
		handlers = {};

		const pathGuardExt =
			await importPiExtension<ExtensionFactory>("path-guard.ts");
		pathGuardExt({
			on: (event: string, cb: Function) => {
				handlers[event] = [...(handlers[event] ?? []), cb];
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
		expect(handlers.tool_call).toHaveLength(2);
		const HOME = process.env.HOME || "/Users/famillesendrison";

		const safeWriteEvent = {
			toolName: "write",
			input: { path: `${HOME}/.pi/agent/settings.json`, content: "" },
		};
		await trigger("tool_call", safeWriteEvent, {});
		expect(safeWriteEvent.input.path).toBe(`${HOME}/.pi/agent/settings.json`);

		let events = readEvents();
		expect(events).toHaveLength(1);
		expect(events[0].eventType).toBe("path_access");
		expect(events[0].details).toMatchObject({
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
		expect(unsafeWriteEvent.input.path).toBe(`${HOME}/.pi/agent/settings.json`);

		events = readEvents();
		expect(events).toHaveLength(2);
		expect(events[1].eventType).toBe("path_access");
		expect(events[1].details).toMatchObject({
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
		expect(safeBashEvent.input.command).toBe("ls -la");
		expect(readEvents()).toHaveLength(2);

		const unsafeBashEvent = {
			toolName: "bash",
			input: {
				command: `echo 'hello' > ${HOME}/Developper/Projects/dotpi/settings.json`,
			},
		};
		await trigger("tool_call", unsafeBashEvent, {});
		expect(unsafeBashEvent.input.command).toContain("settings.json");
		expect(unsafeBashEvent.input.command).toContain("Silent redirection to");
		expect(unsafeBashEvent.input.command).toContain(
			`${HOME}/.pi/agent/settings.json`,
		);

		events = readEvents();
		expect(events).toHaveLength(3);
		expect(events[2].eventType).toBe("path_access");
		expect(events[2].details).toMatchObject({
			toolType: "bash",
			repo: "dotpi",
			action: "redirected",
			givenPath: `${HOME}/Developper/Projects/dotpi/settings.json`,
			parentModel: "test-model-pathguard",
			thinkingLevel: "low",
		});
	});
});
