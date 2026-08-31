import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import {
	importAgentModule,
	importPiExtension,
} from "./pi-extension-loader.node.ts";

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

type ConfirmHandler = (title: string, message: string) => Promise<boolean>;

type CommandValidatorHandler = (
	event: Record<string, unknown>,
	context: ConfirmContext,
) => Promise<HookResult | void> | HookResult | void;

type ExtensionFactory = (pi: {
	on: (event: string, handler: CommandValidatorHandler) => void;
}) => void;

interface PermissionStateModule {
	updatePermissionStateForScope(
		prompt: string,
		scope: { agent: string; sessionId: string },
	): boolean;
}

const { updatePermissionStateForScope } =
	await importAgentModule<PermissionStateModule>(
		"agent-enforcers",
		"permission-enforcer",
		"src",
		"core",
		"state.ts",
	);

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
		const commandValidatorExt = await importPiExtension<ExtensionFactory>(
			"command-validator.ts",
		);
		let handler: CommandValidatorHandler | null = null;
		const registeredEvents: string[] = [];

		const piMock = {
			on: (event: string, callback: CommandValidatorHandler) => {
				registeredEvents.push(event);
				if (event === "tool_call") handler = callback;
			},
		};

		commandValidatorExt(piMock);
		assert.notStrictEqual(handler, null);
		assert.ok(!registeredEvents.includes("before_agent_start"));
		const toolCallHandler = handler as unknown as CommandValidatorHandler;

		const safeResult = await toolCallHandler(
			{ toolName: "bash", input: { command: "ls -la" } },
			createSessionContext(TEST_SCOPE.sessionId),
		);
		assert.strictEqual(safeResult, undefined);

		const prohibitedResult = await toolCallHandler(
			{ toolName: "bash", input: { command: "rm -rf /tmp/stuff" } },
			createSessionContext(TEST_SCOPE.sessionId),
		);
		assert.deepStrictEqual(prohibitedResult, {
			block: true,
			reason: "❌ rm -rf is forbidden - use trash instead",
		});

		const destructiveResult = await toolCallHandler(
			{ toolName: "bash", input: { command: "dd if=/dev/zero of=/dev/sda" } },
			createSessionContext(TEST_SCOPE.sessionId),
		);
		assert.strictEqual(destructiveResult?.block, true);

		const ctxMockReject = createSessionContext(
			TEST_SCOPE.sessionId,
			async () => false,
		);
		const dangerousResultReject = await toolCallHandler(
			{ toolName: "bash", input: { command: "sudo ls" } },
			ctxMockReject,
		);
		assert.deepStrictEqual(dangerousResultReject, {
			block: true,
			reason: "Blocked by user",
		});

		const ctxMockApprove = createSessionContext(
			TEST_SCOPE.sessionId,
			async () => true,
		);
		const dangerousResultApprove = await toolCallHandler(
			{ toolName: "bash", input: { command: "sudo ls" } },
			ctxMockApprove,
		);
		assert.strictEqual(dangerousResultApprove, undefined);

		const restrictedResult = await toolCallHandler(
			{ toolName: "write_to_file", input: { TargetFile: "/tmp/test" } },
			createSessionContext(TEST_SCOPE.sessionId),
		);
		assert.deepStrictEqual(restrictedResult, {
			block: true,
			reason:
				"❌ Permission denied. You cannot implement code without explicit permission. Ask the user to type '/go' to authorize implementation. Never attempt to bypass this restriction.",
		});

		updatePermissionStateForScope("/go", TEST_SCOPE);
		const restrictedAllowedResult = await toolCallHandler(
			{ toolName: "write_to_file", input: { TargetFile: "/tmp/test" } },
			createSessionContext(TEST_SCOPE.sessionId),
		);
		assert.strictEqual(restrictedAllowedResult, undefined);
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
