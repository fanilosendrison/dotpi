/**
 * Node parity target for git-commits-push enforcer detection helpers.
 *
 * The retired source path was
 * extensions/__tests__/git-commits-push-enforcer.test.ts.
 */

import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { importPiExtensionModule } from "./pi-extension-loader.node.ts";

interface GitCommitsPushEnforcerModule {
	detectCommitIntent(cmd: string): string | null;
	detectRawGitMutation(cmd: string): string | null;
	isCommitIntent(cmd: string): boolean;
	isSkillCmd(cmd: string): boolean;
}

const { detectCommitIntent, detectRawGitMutation, isCommitIntent, isSkillCmd } =
	await importPiExtensionModule<GitCommitsPushEnforcerModule>(
		"git-commits-push-enforcer.ts",
	);

describe("git-commits-push-enforcer detection helpers", () => {
	test("detects raw git mutation commands", () => {
		assert.strictEqual(
			detectRawGitMutation("git commit -m 'feat: add x'"),
			"commit",
		);
		assert.strictEqual(
			detectRawGitMutation("git -C /workspace/repo commit -m 'fix: x'"),
			"commit",
		);
		assert.strictEqual(
			detectRawGitMutation("/usr/bin/git commit-tree HEAD"),
			"commit-tree",
		);
		assert.strictEqual(detectRawGitMutation("git push origin main"), "push");
		assert.strictEqual(
			detectRawGitMutation("bash -c 'git commit -m fix: nested'"),
			"commit",
		);
		assert.strictEqual(
			detectRawGitMutation("env -S 'git push origin main'"),
			"push",
		);
	});

	test("ignores quoted git text that is not a git command", () => {
		assert.strictEqual(detectRawGitMutation("rg -n 'git commit' /tmp"), null);
		assert.strictEqual(detectRawGitMutation('echo "git push"'), null);
		assert.strictEqual(
			detectRawGitMutation(
				"cat ~/neelopedia/stats/pi/git-commits-push-enforcer/events.jsonl",
			),
			null,
		);
	});

	test("detects commit intent without matching enforcer paths", () => {
		assert.strictEqual(isCommitIntent("git push"), true);
		assert.strictEqual(isSkillCmd("/git-commits-push"), true);
		assert.strictEqual(
			isSkillCmd(
				"cd /Users/example/.agents/skills/git-commits-push && bun run start",
			),
			false,
		);
		assert.strictEqual(
			isSkillCmd(
				'cd "$HOME/.agents/skills/git-commits-push" && pnpm --silent run start',
			),
			true,
		);
		assert.strictEqual(
			isSkillCmd("cat ~/.agents/skills/git-commits-push-enforcer/README.md"),
			false,
		);
		assert.strictEqual(detectCommitIntent("git push"), "git-commit");
		assert.strictEqual(
			detectCommitIntent("/git-commits-push"),
			"git-commits-push",
		);
		assert.strictEqual(detectCommitIntent("ls -la"), null);
	});
});
