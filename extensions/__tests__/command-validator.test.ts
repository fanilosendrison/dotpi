import { describe, expect, test } from "bun:test";
import commandValidatorExt from "../command-validator";

describe("command-validator Pi extension integration", () => {
	test("registers tool_call handler and handles safe/unsafe/dangerous commands", async () => {
		let handler: Function | null = null;
		const piMock = {
			on: (event: string, cb: Function) => {
				if (event === "tool_call") {
					handler = cb;
				}
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

		// 2. Prohibited command (rm -rf)
		const prohibitedResult = await handler!(
			{ toolName: "bash", input: { command: "rm -rf /tmp/stuff" } },
			{},
		);
		expect(prohibitedResult).toEqual({
			block: true,
			reason: "❌ rm -rf is forbidden - use trash instead",
		});

		// 3. Destructive command pattern (e.g. write to /dev/sda)
		const destructiveResult = await handler!(
			{ toolName: "bash", input: { command: "dd if=/dev/zero of=/dev/sda" } },
			{},
		);
		expect(destructiveResult).toBeDefined();
		expect(destructiveResult!.block).toBe(true);
		expect(destructiveResult!.reason).toContain("Destructive command blocked");

		// 4. Dangerous command (sudo ls) — User rejects confirmation
		let confirmPromptCalled = false;
		const ctxMockReject = {
			ui: {
				confirm: async (title: string, msg: string) => {
					confirmPromptCalled = true;
					return false; // User clicks Cancel
				},
			},
		};
		const dangerousResultReject = await handler!(
			{ toolName: "bash", input: { command: "sudo ls" } },
			ctxMockReject,
		);
		expect(confirmPromptCalled).toBe(true);
		expect(dangerousResultReject).toEqual({
			block: true,
			reason: "Blocked by user",
		});

		// 5. Dangerous command (sudo ls) — User approves confirmation
		confirmPromptCalled = false;
		const ctxMockApprove = {
			ui: {
				confirm: async (title: string, msg: string) => {
					confirmPromptCalled = true;
					return true; // User clicks OK
				},
			},
		};
		const dangerousResultApprove = await handler!(
			{ toolName: "bash", input: { command: "sudo ls" } },
			ctxMockApprove,
		);
		expect(confirmPromptCalled).toBe(true);
		expect(dangerousResultApprove).toBeUndefined(); // Allowed
	});
});
