import { describe, expect, test, mock, beforeEach } from "bun:test";

const appendMock = mock();
mock.module("/Users/famillesendrison/Developper/Projects/telemetry-tools/event-sink/src/index.ts", () => {
	return {
		createEventSink: () => ({
			append: appendMock,
		}),
	};
});

// We must import the extension AFTER mocking the module
import commandValidatorExt from "../command-validator";

describe("command-validator Pi extension integration", () => {
	beforeEach(() => {
		appendMock.mockClear();
	});

	test("registers tool_call handler and handles safe/unsafe/dangerous commands with telemetry", async () => {
		let handler: Function | null = null;
		let beforeProviderHandler: Function | null = null;
		let thinkingLevelHandler: Function | null = null;

		const piMock = {
			on: (event: string, cb: Function) => {
				if (event === "tool_call") handler = cb;
				if (event === "before_provider_request") beforeProviderHandler = cb;
				if (event === "thinking_level_select") thinkingLevelHandler = cb;
			},
		};

		commandValidatorExt(piMock as any);
		expect(handler).not.toBeNull();
		expect(beforeProviderHandler).not.toBeNull();
		expect(thinkingLevelHandler).not.toBeNull();

		// Simulate LLM context
		await beforeProviderHandler!({ payload: { model: "test-model-v1" } });
		await thinkingLevelHandler!({ level: "high" });

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
	});
});
