import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isPermissionGranted } from "/Users/famillesendrison/.agents/agent-enforcers/permission-enforcer/src/core/state.ts";

interface HookResult {
	block?: boolean;
	reason?: string;
}

type ExtensionHandler = (
	event: Record<string, unknown>,
	context?: Record<string, unknown>,
) => Promise<HookResult | void> | HookResult | void;
type HandlerRegistry = Record<string, ExtensionHandler[]>;

const PERMISSION_EXTENSION_PATH =
	"/Users/famillesendrison/.pi/agent/extensions/permission-enforcer.ts";
const COMMAND_VALIDATOR_EXTENSION_PATH =
	"/Users/famillesendrison/.pi/agent/extensions/command-validator.ts";
const TELEMETRY_PATH =
	"/Users/famillesendrison/.pi/agent/extensions/shared/pi-telemetry.ts";

function resetRuntimeModules() {
	mock.restore();
	for (const path of [
		PERMISSION_EXTENSION_PATH,
		COMMAND_VALIDATOR_EXTENSION_PATH,
		TELEMETRY_PATH,
	]) {
		delete require.cache[require.resolve(path)];
	}
}

describe("permission-enforcer and command-validator E2E", () => {
	let tmpDir: string;
	let originalTelemetryBaseDir: string | undefined;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "permission-enforcer-e2e-"));
		originalTelemetryBaseDir = process.env.PI_TELEMETRY_BASE_DIR;
		process.env.PI_TELEMETRY_BASE_DIR = join(tmpDir, "stats");
		process.env.PERMISSION_STATE_PATH = join(tmpDir, "state.json");
	});

	afterEach(() => {
		if (originalTelemetryBaseDir === undefined) {
			delete process.env.PI_TELEMETRY_BASE_DIR;
		} else {
			process.env.PI_TELEMETRY_BASE_DIR = originalTelemetryBaseDir;
		}
		delete process.env.PERMISSION_STATE_PATH;
		if (existsSync(tmpDir)) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	async function registerExtensions(): Promise<HandlerRegistry> {
		resetRuntimeModules();
		const [
			// @ts-ignore: ?real is a Bun feature to bypass module mocks.
			{ default: permissionEnforcerExt },
			// @ts-ignore: ?real is a Bun feature to bypass module mocks.
			{ default: commandValidatorExt },
		] = await Promise.all([
			import("../permission-enforcer?real"),
			import("../command-validator?real"),
		]);

		const handlers: HandlerRegistry = {};
		const piMock = {
			on: (event: string, cb: ExtensionHandler) => {
				handlers[event] = [...(handlers[event] ?? []), cb];
			},
		};

		permissionEnforcerExt(piMock as unknown as ExtensionAPI);
		commandValidatorExt(piMock as unknown as ExtensionAPI);
		return handlers;
	}

	async function emitBeforeAgentStart(
		handlers: HandlerRegistry,
		prompt: string,
	): Promise<void> {
		for (const handler of handlers.before_agent_start ?? []) {
			await handler({ prompt });
		}
	}

	async function emitThinkingLevelSelect(
		handlers: HandlerRegistry,
		level: string,
	): Promise<void> {
		for (const handler of handlers.thinking_level_select ?? []) {
			await handler({ level });
		}
	}

	async function emitToolCall(
		handlers: HandlerRegistry,
		event: Record<string, unknown>,
	): Promise<HookResult | void> {
		let lastResult: HookResult | void;
		for (const handler of handlers.tool_call ?? []) {
			const result = await handler(event, {});
			if (result?.block) return result;
			lastResult = result;
		}
		return lastResult;
	}

	function readEvents(filePath: string): Array<Record<string, unknown>> {
		return readFileSync(filePath, "utf-8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as Record<string, unknown>);
	}

	const restrictedToolCall = {
		toolName: "write_to_file",
		input: { TargetFile: "/tmp/e2e-test" },
	};

	test("prompt state controls restricted tool execution across turns", async () => {
		const handlers = await registerExtensions();

		expect(handlers.before_agent_start).toHaveLength(1);
		expect(handlers.tool_call).toHaveLength(1);

		await emitThinkingLevelSelect(handlers, "e2e-thinking");
		await emitBeforeAgentStart(handlers, "continue without file changes");
		expect(isPermissionGranted()).toBe(false);
		const blockedBeforeGo = await emitToolCall(handlers, restrictedToolCall);
		expect(blockedBeforeGo).toEqual({
			block: true,
			reason: "❌ Permission denied. You cannot implement code without explicit permission. Ask the user to type '/go' to authorize implementation.",
		});

		await emitBeforeAgentStart(handlers, "please /go implement it");
		expect(isPermissionGranted()).toBe(true);
		const allowedAfterGo = await emitToolCall(handlers, restrictedToolCall);
		expect(allowedAfterGo).toBeUndefined();

		await emitBeforeAgentStart(handlers, "continue now");
		expect(isPermissionGranted()).toBe(false);
		const blockedAfterReset = await emitToolCall(handlers, restrictedToolCall);
		expect(blockedAfterReset).toEqual({
			block: true,
			reason: "❌ Permission denied. You cannot implement code without explicit permission. Ask the user to type '/go' to authorize implementation.",
		});

		const permissionEvents = readEvents(
			join(
				tmpDir,
				"stats",
				"permission-enforcer",
				"events.jsonl",
			),
		);
		expect(
			permissionEvents.map(
				(event) => (event.details as Record<string, unknown>).granted,
			),
		).toEqual([false, true, false]);

		const validatorEvents = readEvents(
			join(
				tmpDir,
				"stats",
				"command-validator",
				"events.jsonl",
			),
		);
		expect(
			validatorEvents.map(
				(event) => (event.details as Record<string, unknown>).action,
			),
		).toEqual(["deny", "allow", "deny"]);
		expect(JSON.stringify(permissionEvents)).not.toContain(
			"please /go implement it",
		);
	});
});
