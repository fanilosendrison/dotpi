import { describe, expect, test, mock } from "bun:test";

// We mock node:child_process's execSync BEFORE importing the extension
let mockDiff = "";
mock.module("node:child_process", () => ({
	execSync: (cmd: string) => {
		if (cmd.includes("git diff")) {
			return mockDiff;
		}
		throw new Error("Unexpected command: " + cmd);
	},
}));

import secretScannerExt from "../secret-scanner";

describe("secret-scanner Pi extension integration", () => {
	test("registers tool_call handler and scans git commits for secrets", async () => {
		let handler: Function | null = null;
		const piMock = {
			on: (event: string, cb: Function) => {
				if (event === "tool_call") {
					handler = cb;
				}
			},
		};

		secretScannerExt(piMock as any);
		expect(handler).not.toBeNull();

		// 1. Non-commit command
		const nonCommitResult = await handler!(
			{ toolName: "bash", input: { command: "ls -la" } },
			{},
		);
		expect(nonCommitResult).toBeUndefined();

		// 2. Commit command with clean diff
		mockDiff = "";
		const cleanCommitResult = await handler!(
			{ toolName: "bash", input: { command: "git commit -m 'feat: clean'" } },
			{},
		);
		expect(cleanCommitResult).toBeUndefined();

		// 3. Commit command with secrets in diff
		mockDiff = `diff --git a/test.txt b/test.txt
index 12345..67890 100644
--- a/test.txt
+++ b/test.txt
@@ -1 +1,2 @@
+some text
+AKIAIOSFODNN7EXAMPLE`;

		const dirtyCommitResult = await handler!(
			{ toolName: "bash", input: { command: "git commit -m 'feat: dirty'" } },
			{},
		);
		expect(dirtyCommitResult).toBeDefined();
		expect(dirtyCommitResult!.block).toBe(true);
		expect(dirtyCommitResult!.reason).toContain("Secret(s) detected");
		expect(dirtyCommitResult!.reason).toContain("AWS Access Key");
	});
});
