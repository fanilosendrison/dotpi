import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

interface HookResult {
	block?: boolean;
	reason?: string;
}

interface ConfirmContext {
	ui?: {
		confirm(title: string, message: string): Promise<boolean>;
	};
}

type CommandValidatorHandler = (
	event: Record<string, unknown>,
	context: ConfirmContext,
) => Promise<HookResult | void> | HookResult | void;

const EXTENSION_PATH =
	"/Users/famillesendrison/.pi/agent/extensions/command-validator.ts";
const TELEMETRY_PATH =
	"/Users/famillesendrison/.pi/agent/extensions/shared/pi-telemetry.ts";

function resetRuntimeModules() {
	mock.restore();
	for (const path of [EXTENSION_PATH, TELEMETRY_PATH]) {
		delete require.cache[require.resolve(path)];
	}
}

describe("command-validator Pi extension integration", () => {
	let tmpDir: string;
	let originalTelemetryBaseDir: string | undefined;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "command-validator-integration-"));
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

	test("registers tool_call handler and handles safe/unsafe/dangerous commands", async () => {
		resetRuntimeModules();
		// @ts-ignore: ?real is a Bun feature to bypass module mocks.
		const { default: commandValidatorExt } = await import(
			"../command-validator?real"
		);
		let handler: CommandValidatorHandler | null = null;
		const registeredEvents: string[] = [];

		const piMock = {
			on: (event: string, cb: CommandValidatorHandler) => {
				registeredEvents.push(event);
				if (event === "tool_call") handler = cb;
			},
		};

		commandValidatorExt(piMock as unknown as ExtensionAPI);
		expect(handler).not.toBeNull();
		expect(registeredEvents).not.toContain("before_agent_start");

		const safeResult = await handler!(
			{ toolName: "bash", input: { command: "ls -la" } },
			{},
		);
		expect(safeResult).toBeUndefined();

		const prohibitedResult = await handler!(
			{ toolName: "bash", input: { command: "rm -rf /tmp/stuff" } },
			{},
		);
		expect(prohibitedResult).toEqual({
			block: true,
			reason: "❌ rm -rf is forbidden - use trash instead",
		});

		const destructiveResult = await handler!(
			{ toolName: "bash", input: { command: "dd if=/dev/zero of=/dev/sda" } },
			{},
		);
		expect(destructiveResult?.block).toBe(true);

		const ctxMockReject = { ui: { confirm: async () => false } };
		const dangerousResultReject = await handler!(
			{ toolName: "bash", input: { command: "sudo ls" } },
			ctxMockReject,
		);
		expect(dangerousResultReject).toEqual({
			block: true,
			reason: "Blocked by user",
		});

		const ctxMockApprove = { ui: { confirm: async () => true } };
		const dangerousResultApprove = await handler!(
			{ toolName: "bash", input: { command: "sudo ls" } },
			ctxMockApprove,
		);
		expect(dangerousResultApprove).toBeUndefined();

		const restrictedResult = await handler!(
			{ toolName: "write_to_file", input: { TargetFile: "/tmp/test" } },
			{},
		);
		expect(restrictedResult).toEqual({
			block: true,
			reason: "❌ Permission denied. You cannot implement code without explicit permission. Ask the user to type '/go' to authorize implementation.",
		});
	});
});
