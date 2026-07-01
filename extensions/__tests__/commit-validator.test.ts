import { describe, expect, test } from "bun:test";
import commitValidatorExt from "../commit-validator";

describe("commit-validator Pi extension integration", () => {
	test("registers tool_call handler and validates commit commands", async () => {
		let handler: Function | null = null;
		const piMock = {
			on: (event: string, cb: Function) => {
				if (event === "tool_call") {
					handler = cb;
				}
			},
		};

		commitValidatorExt(piMock as any);
		expect(handler).not.toBeNull();

		// 1. Safe non-commit command
		const nonCommitResult = await handler!(
			{ toolName: "bash", input: { command: "ls -la" } },
			{},
		);
		expect(nonCommitResult).toBeUndefined();

		// 2. Valid git commit command
		const validCommitResult = await handler!(
			{ toolName: "bash", input: { command: "git commit -m 'feat(api): add endpoint'" } },
			{},
		);
		expect(validCommitResult).toBeUndefined();

		// 3. Invalid git commit command
		const invalidCommitResult = await handler!(
			{ toolName: "bash", input: { command: "git commit -m 'WIP: test'" } },
			{},
		);
		expect(invalidCommitResult).toBeDefined();
		expect(invalidCommitResult!.block).toBe(true);
		expect(invalidCommitResult!.reason).toContain("Commit message invalide");
	});
});
