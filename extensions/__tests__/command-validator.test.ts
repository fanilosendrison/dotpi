import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { updatePermissionStateForScope } from "/Users/famillesendrison/.agents/agent-enforcers/permission-enforcer/src/core/state.ts";
import { importPiExtension } from "./pi-extension-loader";

const TEST_SCOPE = { agent: "pi", sessionId: "pi-session-a" };

interface HookResult {
	block?: boolean;
	reason?: string;
}

interface ConfirmContext {
	sessionManager: {
		getSessionId(): string;
	};
	ui?: {
		confirm(title: string, message: string): Promise<boolean>;
	};
}

type ConfirmHandler = (
	title: string,
	message: string,
) => Promise<boolean>;

type CommandValidatorHandler = (
	event: Record<string, unknown>,
	context: ConfirmContext,
) => Promise<HookResult | void> | HookResult | void;

const TELEMETRY_PATH =
	"/Users/famillesendrison/.pi/agent/extensions/shared/pi-telemetry.ts";

function resetRuntimeModules() {
	mock.restore();
	for (const path of [TELEMETRY_PATH]) {
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
		const commandValidatorExt =
			await importPiExtension<(pi: ExtensionAPI) => void>(
				"command-validator.ts",
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
			createSessionContext(TEST_SCOPE.sessionId),
		);
		expect(safeResult).toBeUndefined();

		const prohibitedResult = await handler!(
			{ toolName: "bash", input: { command: "rm -rf /tmp/stuff" } },
			createSessionContext(TEST_SCOPE.sessionId),
		);
		expect(prohibitedResult).toEqual({
			block: true,
			reason: "❌ rm -rf is forbidden - use trash instead",
		});

		const destructiveResult = await handler!(
			{ toolName: "bash", input: { command: "dd if=/dev/zero of=/dev/sda" } },
			createSessionContext(TEST_SCOPE.sessionId),
		);
		expect(destructiveResult?.block).toBe(true);

		const ctxMockReject = createSessionContext(TEST_SCOPE.sessionId, async () => false);
		const dangerousResultReject = await handler!(
			{ toolName: "bash", input: { command: "sudo ls" } },
			ctxMockReject,
		);
		expect(dangerousResultReject).toEqual({
			block: true,
			reason: "Blocked by user",
		});

		const ctxMockApprove = createSessionContext(TEST_SCOPE.sessionId, async () => true);
		const dangerousResultApprove = await handler!(
			{ toolName: "bash", input: { command: "sudo ls" } },
			ctxMockApprove,
		);
		expect(dangerousResultApprove).toBeUndefined();

		const restrictedResult = await handler!(
			{ toolName: "write_to_file", input: { TargetFile: "/tmp/test" } },
			createSessionContext(TEST_SCOPE.sessionId),
		);
		expect(restrictedResult).toEqual({
			block: true,
			reason: "❌ Permission denied. You cannot implement code without explicit permission. Ask the user to type '/go' to authorize implementation.",
		});

		updatePermissionStateForScope("/go", TEST_SCOPE);
		const restrictedAllowedResult = await handler!(
			{ toolName: "write_to_file", input: { TargetFile: "/tmp/test" } },
			createSessionContext(TEST_SCOPE.sessionId),
		);
		expect(restrictedAllowedResult).toBeUndefined();
	});
});

function createSessionContext(
	sessionId: string,
	confirm?: ConfirmHandler,
): ConfirmContext {
	return {
		sessionManager: {
			getSessionId: () => sessionId,
		},
		ui: confirm ? { confirm } : undefined,
	};
}
