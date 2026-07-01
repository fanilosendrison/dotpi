import { describe, expect, test } from "bun:test";
import pushEnforcerExt from "../git-commits-push-enforcer";

describe("git-commits-push-enforcer Pi extension integration", () => {
	test("registers tool_call handler and enforces commit + push rules", async () => {
		let handler: Function | null = null;
		const piMock = {
			on: (event: string, cb: Function) => {
				if (event === "tool_call") {
					handler = cb;
				}
			},
		};

		pushEnforcerExt(piMock as any);
		expect(handler).not.toBeNull();

		// 1. Safe non-commit command
		const nonCommitResult = await handler!(
			{ toolName: "bash", input: { command: "ls -la" } },
			{},
		);
		expect(nonCommitResult).toBeUndefined();

		// 2. Commit without push (blocked)
		const commitNoPushResult = await handler!(
			{ toolName: "bash", input: { command: "git commit -m 'feat(api): add endpoint'" } },
			{},
		);
		expect(commitNoPushResult).toBeDefined();
		expect(commitNoPushResult!.block).toBe(true);
		expect(commitNoPushResult!.reason).toContain("Always push after commit");

		// 3. Commit with push but invalid CC message (blocked)
		const invalidCcResult = await handler!(
			{ toolName: "bash", input: { command: "git commit -m 'WIP' && git push" } },
			{},
		);
		expect(invalidCcResult).toBeDefined();
		expect(invalidCcResult!.block).toBe(true);
		expect(invalidCcResult!.reason).toContain("Use /git-commits-push to generate");

		// 4. Valid commit and push (allowed)
		const validResult = await handler!(
			{ toolName: "bash", input: { command: "git commit -m 'feat(api): add endpoint' && git push" } },
			{},
		);
		expect(validResult).toBeUndefined();
	});
});
