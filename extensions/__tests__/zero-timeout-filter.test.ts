import { describe, expect, test } from "bun:test";
import zeroTimeoutFilter from "../zero-timeout-filter";

const SKILL_CMD =
	"cd /Users/famillesendrison/.agents/skills/git-commits-push && bun run start";

describe("zero-timeout-filter", () => {
	let handler: Function | null = null;

	const piMock = {
		on: (event: string, cb: Function) => {
			if (event === "tool_call") {
				handler = cb;
			}
		},
	};

	zeroTimeoutFilter(piMock as any);

	test("registers tool_call handler", () => {
		expect(handler).not.toBeNull();
	});

	// ── Does nothing on non-matching commands ───────────────────────────────

	test("ignores non-bash tools", async () => {
		const input = { command: SKILL_CMD, timeout: 30 };
		await handler!({ toolName: "write", input }, {});
		expect(input.timeout).toBe(30); // unchanged
	});

	test("ignores bash commands that are not the skill", async () => {
		const input = { command: "echo hello", timeout: 30 };
		await handler!({ toolName: "bash", input }, {});
		expect(input.timeout).toBe(30); // unchanged
	});

	test("ignores git commit commands", async () => {
		const input = {
			command: "git commit -m 'feat: x' && git push",
			timeout: 30,
		};
		await handler!({ toolName: "bash", input }, {});
		expect(input.timeout).toBe(30); // unchanged
	});

	test("ignores /git-commits-push command", async () => {
		const input = { command: "/git-commits-push", timeout: 30 };
		await handler!({ toolName: "bash", input }, {});
		expect(input.timeout).toBe(30); // unchanged
	});

	// ── Strips timeout from skill invocation ────────────────────────────────

	test("deletes timeout for the exact skill command", async () => {
		const input = { command: SKILL_CMD, timeout: 60 };
		await handler!({ toolName: "bash", input }, {});
		expect(input.timeout).toBeUndefined();
	});

	test("works without timeout set (no-op delete)", async () => {
		const input = { command: SKILL_CMD };
		await handler!({ toolName: "bash", input }, {});
		expect(input.timeout).toBeUndefined();
	});

	test("works with zero timeout", async () => {
		const input = { command: SKILL_CMD, timeout: 0 };
		await handler!({ toolName: "bash", input }, {});
		expect(input.timeout).toBeUndefined();
	});

	test("matches when command starts with cd ~/", async () => {
		const input = {
			command: "cd ~/.agents/skills/git-commits-push && bun run start",
			timeout: 30,
		};
		await handler!({ toolName: "bash", input }, {});
		expect(input.timeout).toBeUndefined();
	});

	test("does not mutate other input fields", async () => {
		const input = {
			command: SKILL_CMD,
			timeout: 60,
			cwd: "/tmp",
			extra: "preserved",
		};
		await handler!({ toolName: "bash", input }, {});
		expect(input.cwd).toBe("/tmp");
		expect(input.extra).toBe("preserved");
	});

	// ── Edge cases ─────────────────────────────────────────────────────────

	test("handles undefined command gracefully", async () => {
		const input = { timeout: 30 };
		await handler!({ toolName: "bash", input }, {});
		expect(input.timeout).toBe(30); // unchanged
	});

	test("handles null command gracefully", async () => {
		const input = { command: null, timeout: 30 };
		await handler!({ toolName: "bash", input }, {});
		expect(input.timeout).toBe(30); // unchanged
	});
});
