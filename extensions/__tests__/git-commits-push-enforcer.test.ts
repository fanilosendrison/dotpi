import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const appendMock = mock();
mock.module(
	"/Users/famillesendrison/.pi/agent/extensions/shared/pi-telemetry.ts",
	() => ({
		createPiTelemetry: () => ({
			sink: { append: appendMock },
			model: "test-model-enforcer",
			thinking: "low",
			sessionId: "test-session-uuid-enforcer",
		}),
	}),
);

import pushEnforcerExt, {
	detectCommitIntent,
	detectRawGitMutation,
	isCommitIntent,
	isSkillCmd,
} from "../git-commits-push-enforcer";

const originalBypass = process.env.BYPASS_GIT_ENFORCER;

interface ToolCallEvent {
	toolName: string;
	toolCallId?: string;
	input: Record<string, unknown>;
}

interface BlockResponse {
	block: true;
	reason: string;
}

type ToolCallHandler = (
	event: ToolCallEvent,
	context: Record<string, unknown>,
) => Promise<BlockResponse | undefined> | BlockResponse | undefined;

afterAll(() => {
	if (originalBypass === undefined) {
		delete process.env.BYPASS_GIT_ENFORCER;
	} else {
		process.env.BYPASS_GIT_ENFORCER = originalBypass;
	}
	mock.restore();
});

describe("git-commits-push-enforcer Pi extension", () => {
	const handlers: Partial<Record<"tool_call", ToolCallHandler>> = {};

	const piMock = {
		on: (event: string, cb: ToolCallHandler) => {
			if (event === "tool_call") {
				handlers.tool_call = cb;
			}
		},
	};

	pushEnforcerExt(piMock as unknown as ExtensionAPI);

	beforeEach(() => {
		appendMock.mockClear();
		delete process.env.BYPASS_GIT_ENFORCER;
		delete process.env.PI_PARENT_MODEL;
		delete process.env.PI_SESSION_ID;
	});

	// ── Handler registration ───────────────────────────────────────────────

	test("registers tool_call handler", () => {
		expect(handlers.tool_call).toBeDefined();
	});

	// ── Detection helpers ──────────────────────────────────────────────────

	describe("detection helpers", () => {
		test("detects raw git mutation commands", () => {
			expect(detectRawGitMutation("git commit -m 'feat: add x'")).toBe(
				"commit",
			);
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
			expect(detectRawGitMutation("env -S 'git push origin main'")).toBe(
				"push",
			);
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
				isSkillCmd("cat ~/.agents/skills/git-commits-push-enforcer/README.md"),
			).toBe(false);
			expect(detectCommitIntent("git push")).toBe("git-commit");
			expect(detectCommitIntent("/git-commits-push")).toBe("git-commits-push");
		});
	});

	// ── tool_call ──────────────────────────────────────────────────────────

	describe("tool_call", () => {
		const h = () => {
			const handler = handlers.tool_call;
			if (!handler) throw new Error("expected tool_call handler");
			return handler;
		};

		test("ignores non-bash tools", async () => {
			const result = await h()(
				{ toolName: "write", input: { file_path: "/tmp/x" } },
				{},
			);
			expect(result).toBeUndefined();
			expect(appendMock).not.toHaveBeenCalled();
		});

		test("ignores non-commit bash commands", async () => {
			const result = await h()(
				{ toolName: "bash", input: { command: "ls -la" } },
				{},
			);
			expect(result).toBeUndefined();
			expect(appendMock).not.toHaveBeenCalled();
		});

		test("blocks raw git commit commands and writes blocked telemetry", async () => {
			const result = await h()(
				{
					toolName: "bash",
					toolCallId: "call-commit-1",
					input: { command: "git commit -m 'feat: add x'" },
				},
				{},
			);
			expect(result).toMatchObject({
				block: true,
				reason: expect.stringContaining("Use /git-commits-push"),
			});
			expect(appendMock).toHaveBeenCalledTimes(1);
			expect(appendMock.mock.calls[0][0]).toBe("blocked");
			expect(appendMock.mock.calls[0][1]).toMatchObject({
				rawCommand: "git commit -m 'feat: add x'",
				detectedBy: "git-commit",
				mutation: "commit",
				toolCallId: "call-commit-1",
				parentModel: "test-model-enforcer",
				thinkingLevel: "low",
			});
		});

		test("blocks git -C commit, commit-tree, and push commands", async () => {
			for (const [command, mutation] of [
				["git -C /workspace/repo commit -m 'fix: x'", "commit"],
				["git commit-tree HEAD", "commit-tree"],
				["git push origin main", "push"],
			] as const) {
				appendMock.mockClear();
				const result = await h()(
					{
						toolName: "bash",
						toolCallId: `call-${mutation}`,
						input: { command },
					},
					{},
				);

				expect(result).toMatchObject({ block: true });
				expect(appendMock).toHaveBeenCalledTimes(1);
				expect(appendMock.mock.calls[0][0]).toBe("blocked");
				expect(appendMock.mock.calls[0][1]).toMatchObject({
					rawCommand: command,
					detectedBy: "git-commit",
					mutation,
					toolCallId: `call-${mutation}`,
				});
			}
		});

		test("allows raw git mutations only with process-level bypass", async () => {
			process.env.BYPASS_GIT_ENFORCER = "1";

			const result = await h()(
				{
					toolName: "bash",
					toolCallId: "call-bypass",
					input: { command: "git commit -m 'fix: bypass'" },
				},
				{},
			);

			expect(result).toBeUndefined();
			expect(appendMock).toHaveBeenCalledTimes(1);
			expect(appendMock.mock.calls[0][0]).toBe("skipped");
			expect(appendMock.mock.calls[0][1]).toMatchObject({
				rawCommand: "git commit -m 'fix: bypass'",
				detectedBy: "git-commit",
				mutation: "commit",
				reason: "bypass-enforcer",
				toolCallId: "call-bypass",
			});
		});

		test("processes /git-commits-push commands", async () => {
			const result = await h()(
				{
					toolName: "bash",
					input: { command: "/git-commits-push" },
				},
				{},
			);
			expect(result).toBeUndefined();
			expect(appendMock).toHaveBeenCalledTimes(1);
			expect(appendMock.mock.calls[0][1]).toMatchObject({
				rawCommand: "/git-commits-push",
				detectedBy: "git-commits-push",
				parentModel: "test-model-enforcer",
				thinkingLevel: "low",
			});
			expect(process.env.PI_PARENT_MODEL).toBe("test-model-enforcer");
			expect(process.env.PI_SESSION_ID).toBe("test-session-uuid-enforcer");
		});

		test("processes skill launch command", async () => {
			const result = await h()(
				{
					toolName: "bash",
					input: {
						command:
							"cd /Users/famillesendrison/.agents/skills/git-commits-push && bun run start",
					},
				},
				{},
			);
			expect(result).toBeUndefined();
			expect(appendMock).toHaveBeenCalledTimes(1);
			expect(appendMock.mock.calls[0][1].detectedBy).toBe("git-commits-push");
		});

		test("ignores commands containing git-commits-push-enforcer path", async () => {
			const result = await h()(
				{
					toolName: "bash",
					input: {
						command: "cat /Users/.../git-commits-push-enforcer/events.jsonl",
					},
				},
				{},
			);
			expect(result).toBeUndefined();
			expect(appendMock).not.toHaveBeenCalled();
		});
	});
});
