import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
import { existsSync, unlinkSync } from "node:fs";

const appendMock = mock();
mock.module(
	"/Users/famillesendrison/.pi/agent/extensions/shared/pi-telemetry.ts",
	() => ({
		createPiTelemetry: () => ({
			sink: { append: appendMock },
			model: "test-model-v1",
			thinking: "high",
			sessionId: "test-session-uuid-1234",
		}),
	}),
);

// Import AFTER mocking
import commandValidatorExt from "../command-validator";

describe("command-validator Pi extension integration", () => {
	const TEST_STATE_PATH = "/tmp/cv-integration-test-state.json";

	beforeEach(() => {
		appendMock.mockClear();
		process.env.PERMISSION_STATE_PATH = TEST_STATE_PATH;
		if (existsSync(TEST_STATE_PATH)) {
			unlinkSync(TEST_STATE_PATH);
		}
	});

	afterEach(() => {
		if (existsSync(TEST_STATE_PATH)) {
			unlinkSync(TEST_STATE_PATH);
		}
		delete process.env.PERMISSION_STATE_PATH;
	});

	test("registers tool_call handler and handles safe/unsafe/dangerous commands with telemetry", async () => {
		let handler: Function | null = null;
		let beforeAgentStartHandler: Function | null = null;

		const piMock = {
			on: (event: string, cb: Function) => {
				if (event === "tool_call") handler = cb;
				if (event === "before_agent_start") beforeAgentStartHandler = cb;
			},
		};

		commandValidatorExt(piMock as any);
		expect(handler).not.toBeNull();

		// 1. Safe command
		const safeResult = await handler!(
			{ toolName: "bash", input: { command: "ls -la" } },
			{},
		);
		expect(safeResult).toBeUndefined();
		expect(appendMock).toHaveBeenCalledTimes(1);
		expect(appendMock.mock.calls[0][0]).toBe("validation_result");
		expect(appendMock.mock.calls[0][1]).toMatchObject({
			action: "allow",
			rawCommand: "ls -la",
			parentModel: "test-model-v1",
			thinkingLevel: "high",
		});

		// 2. Prohibited command (rm -rf)
		const prohibitedResult = await handler!(
			{ toolName: "bash", input: { command: "rm -rf /tmp/stuff" } },
			{},
		);
		expect(prohibitedResult).toEqual({
			block: true,
			reason: "❌ rm -rf is forbidden - use trash instead",
		});
		expect(appendMock).toHaveBeenCalledTimes(2);
		expect(appendMock.mock.calls[1][1]).toMatchObject({
			action: "deny",
			rawCommand: "rm -rf /tmp/stuff",
			reason: "❌ rm -rf is forbidden - use trash instead",
		});

		// 3. Destructive command pattern
		const destructiveResult = await handler!(
			{ toolName: "bash", input: { command: "dd if=/dev/zero of=/dev/sda" } },
			{},
		);
		expect(destructiveResult!.block).toBe(true);
		expect(appendMock).toHaveBeenCalledTimes(3);
		expect(appendMock.mock.calls[2][1].action).toBe("deny");

		// 4. Dangerous command (sudo ls) — User rejects
		const ctxMockReject = { ui: { confirm: async () => false } };
		const dangerousResultReject = await handler!(
			{ toolName: "bash", input: { command: "sudo ls" } },
			ctxMockReject,
		);
		expect(dangerousResultReject).toEqual({
			block: true,
			reason: "Blocked by user",
		});
		expect(appendMock).toHaveBeenCalledTimes(4);
		expect(appendMock.mock.calls[3][1]).toMatchObject({
			action: "ask_rejected",
			userResponse: "no",
			rawCommand: "sudo ls",
		});

		// 5. Dangerous command (sudo ls) — User approves
		const ctxMockApprove = { ui: { confirm: async () => true } };
		const dangerousResultApprove = await handler!(
			{ toolName: "bash", input: { command: "sudo ls" } },
			ctxMockApprove,
		);
		expect(dangerousResultApprove).toBeUndefined(); // Allowed
		expect(appendMock).toHaveBeenCalledTimes(5);
		expect(appendMock.mock.calls[4][1]).toMatchObject({
			action: "ask_approved",
			userResponse: "yes",
			rawCommand: "sudo ls",
		});
		// 6. Restricted tool without /go permission (should block)
		const restrictedResult = await handler!(
			{ toolName: "write_to_file", input: { TargetFile: "/tmp/test" } },
			{},
		);
		expect(restrictedResult).toEqual({
			block: true,
			reason: "❌ Permission denied. You cannot implement code without explicit permission. Ask the user to type '/go' to authorize implementation.",
		});
		expect(appendMock).toHaveBeenCalledTimes(6);
		expect(appendMock.mock.calls[5][1]).toMatchObject({
			action: "deny",
			toolName: "write_to_file",
		});

		// 7. Fire before_agent_start with /go -> should grant permission
		expect(beforeAgentStartHandler).not.toBeNull();
		await beforeAgentStartHandler!({ prompt: "please /go ahead" });

		// 8. Restricted tool with /go permission (should allow/be undefined)
		const restrictedResultAllowed = await handler!(
			{ toolName: "write_to_file", input: { TargetFile: "/tmp/test" } },
			{},
		);
		expect(restrictedResultAllowed).toBeUndefined();

		// 9. Fire before_agent_start without /go -> should revoke permission
		await beforeAgentStartHandler!({ prompt: "done now" });
		const restrictedResultBlockedAgain = await handler!(
			{ toolName: "write_to_file", input: { TargetFile: "/tmp/test" } },
			{},
		);
		expect(restrictedResultBlockedAgain).toEqual({
			block: true,
			reason: "❌ Permission denied. You cannot implement code without explicit permission. Ask the user to type '/go' to authorize implementation.",
		});
	});
});
