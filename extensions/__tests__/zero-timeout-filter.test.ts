import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import zeroTimeoutFilter from "../zero-timeout-filter";

const SKILL_CMD =
	"cd /Users/famillesendrison/.agents/skills/git-commits-push && bun run start";

const TEST_STATS_DIR = path.join(os.tmpdir(), "ztf-test-" + Date.now());
beforeEach(() => {
	process.env.ZERO_TIMEOUT_FILTER_STATS_DIR = TEST_STATS_DIR;
	fs.mkdirSync(TEST_STATS_DIR, { recursive: true });
});
afterEach(() => {
	delete process.env.ZERO_TIMEOUT_FILTER_STATS_DIR;
	if (fs.existsSync(TEST_STATS_DIR))
		fs.rmSync(TEST_STATS_DIR, { recursive: true, force: true });
});

describe("zero-timeout-filter", () => {
	// Reset cached statsLog between runs by re-creating the extension
	// via a fresh zeroTimeoutFilter call
	const handlers: Record<string, Function> = {};

	const piMock = {
		on: (event: string, cb: Function) => {
			handlers[event] = cb;
		},
	};

	zeroTimeoutFilter(piMock as any);

	// ── Handler registration ───────────────────────────────────────────────

	test("registers tool_call handler", () => {
		expect(handlers["tool_call"]).toBeDefined();
	});

	test("registers before_provider_request handler", () => {
		expect(handlers["before_provider_request"]).toBeDefined();
	});

	// ── Does nothing on non-matching commands ───────────────────────────────

	test("ignores non-bash tools", async () => {
		const input = { command: SKILL_CMD, timeout: 30 };
		await handlers["tool_call"]({ toolName: "write", input }, {});
		expect(input.timeout).toBe(30);
	});

	test("ignores bash commands that are not the skill", async () => {
		const input = { command: "echo hello", timeout: 30 };
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBe(30);
	});

	test("ignores git commit commands", async () => {
		const input = {
			command: "git commit -m 'feat: x' && git push",
			timeout: 30,
		};
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBe(30);
	});

	test("ignores /git-commits-push command", async () => {
		const input = { command: "/git-commits-push", timeout: 30 };
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBe(30);
	});

	// ── Strips timeout from skill invocation ────────────────────────────────

	test("deletes timeout for the exact skill command", async () => {
		const input = { command: SKILL_CMD, timeout: 60 };
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBeUndefined();
	});

	test("works without timeout set (no-op delete)", async () => {
		const input = { command: SKILL_CMD };
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBeUndefined();
	});

	test("works with zero timeout", async () => {
		const input = { command: SKILL_CMD, timeout: 0 };
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBeUndefined();
	});

	test("matches when command starts with cd ~/", async () => {
		const input = {
			command: "cd ~/.agents/skills/git-commits-push && bun run start",
			timeout: 30,
		};
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBeUndefined();
	});

	test("does not mutate other input fields", async () => {
		const input = {
			command: SKILL_CMD,
			timeout: 60,
			cwd: "/tmp",
			extra: "preserved",
		};
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.cwd).toBe("/tmp");
		expect(input.extra).toBe("preserved");
	});

	// ── Captures model and thinking ─────────────────────────────────────────

	test("captures model from before_provider_request", async () => {
		await handlers["before_provider_request"](
			{ payload: { model: "deepseek-v4-pro" } },
			{},
		);
	});

	test("captures thinking level from thinking_level_select", async () => {
		await handlers["thinking_level_select"](
			{ level: "xhigh", previousLevel: undefined },
			{},
		);
	});

	// ── Edge cases ─────────────────────────────────────────────────────────

	test("handles undefined command gracefully", async () => {
		const input = { timeout: 30 };
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBe(30);
	});

	test("handles null command gracefully", async () => {
		const input = { command: null, timeout: 30 };
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBe(30);
	});
});
