import { describe, expect, test } from "bun:test";
import { importPiExtensionModule } from "./pi-extension-loader";

interface GitCommitsPushEnforcerModule {
	detectCommitIntent(cmd: string): string | null;
	detectRawGitMutation(cmd: string): string | null;
	isCommitIntent(cmd: string): boolean;
	isSkillCmd(cmd: string): boolean;
}

const {
	detectCommitIntent,
	detectRawGitMutation,
	isCommitIntent,
	isSkillCmd,
} = await importPiExtensionModule<GitCommitsPushEnforcerModule>(
	"git-commits-push-enforcer.ts",
);

describe("git-commits-push-enforcer detection helpers", () => {
	test("detects raw git mutation commands", () => {
		expect(detectRawGitMutation("git commit -m 'feat: add x'")).toBe("commit");
		expect(
			detectRawGitMutation("git -C /workspace/repo commit -m 'fix: x'"),
		).toBe("commit");
		expect(detectRawGitMutation("/usr/bin/git commit-tree HEAD")).toBe(
			"commit-tree",
		);
		expect(detectRawGitMutation("git push origin main")).toBe("push");
		expect(detectRawGitMutation("bash -c 'git commit -m fix: nested'")).toBe(
			"commit",
		);
		expect(detectRawGitMutation("env -S 'git push origin main'")).toBe("push");
	});

	test("ignores quoted git text that is not a git command", () => {
		expect(detectRawGitMutation("rg -n 'git commit' /tmp")).toBeNull();
		expect(detectRawGitMutation('echo "git push"')).toBeNull();
		expect(
			detectRawGitMutation(
				"cat ~/neelopedia/stats/pi/git-commits-push-enforcer/events.jsonl",
			),
		).toBeNull();
	});

	test("detects commit intent without matching enforcer paths", () => {
		expect(isCommitIntent("git push")).toBe(true);
		expect(isSkillCmd("/git-commits-push")).toBe(true);
		expect(
			isSkillCmd(
				"cd /Users/famillesendrison/.agents/skills/git-commits-push && bun run start",
			),
		).toBe(true);
		expect(
			isSkillCmd(
				'cd "$HOME/.agents/skills/git-commits-push" && pnpm --silent run start',
			),
		).toBe(true);
		expect(
			isSkillCmd("cat ~/.agents/skills/git-commits-push-enforcer/README.md"),
		).toBe(false);
		expect(detectCommitIntent("git push")).toBe("git-commit");
		expect(detectCommitIntent("/git-commits-push")).toBe("git-commits-push");
		expect(detectCommitIntent("ls -la")).toBeNull();
	});
});
