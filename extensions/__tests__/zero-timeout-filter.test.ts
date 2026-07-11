import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

const appendMock = mock();
mock.module(
	"/Users/famillesendrison/.pi/agent/extensions/shared/pi-telemetry.ts",
	() => ({
		createPiTelemetry: () => ({
			sink: { append: appendMock },
			model: "m-filter",
			thinking: "high",
			sessionId: "test-session-uuid-filter",
			contextDetails: () => ({
				parentModel: "m-filter",
				thinkingLevel: "high",
			}),
			append: (
				eventType: string,
				details: Record<string, unknown>,
				overrides?: Record<string, unknown>,
			) =>
				appendMock(
					eventType,
					{
						...details,
						parentModel: "m-filter",
						thinkingLevel: "high",
					},
					overrides,
				),
		}),
	}),
);

import zeroTimeoutFilter from "../zero-timeout-filter";

afterAll(() => {
	mock.restore();
});

const SKILL_CMD =
	"cd /Users/famillesendrison/.agents/skills/git-commits-push && bun run start";

describe("zero-timeout-filter", () => {
	const handlers: Record<string, Function> = {};

	const piMock = {
		on: (event: string, cb: Function) => {
			handlers[event] = cb;
		},
	};

	zeroTimeoutFilter(piMock as any);

	beforeEach(() => {
		appendMock.mockClear();
	});

	// ── Handler registration ───────────────────────────────────────────────

	test("registers tool_call handler", () => {
		expect(handlers["tool_call"]).toBeDefined();
	});

	// ── Does nothing on non-matching commands ───────────────────────────────

	test("ignores non-bash tools", async () => {
		const input = { command: SKILL_CMD, timeout: 30 };
		await handlers["tool_call"]({ toolName: "write", input }, {});
		expect(input.timeout).toBe(30);
		expect(appendMock).not.toHaveBeenCalled();
	});

	test("ignores bash commands that are not the skill", async () => {
		const input = { command: "echo hello", timeout: 30 };
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBe(30);
		expect(appendMock).not.toHaveBeenCalled();
	});

	test("ignores git commit commands", async () => {
		const input = {
			command: "git commit -m 'feat: x' && git push",
			timeout: 30,
		};
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBe(30);
		expect(appendMock).not.toHaveBeenCalled();
	});

	test("ignores /git-commits-push command", async () => {
		const input = { command: "/git-commits-push", timeout: 30 };
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBe(30);
		expect(appendMock).not.toHaveBeenCalled();
	});

	// ── Strips timeout from skill invocation ────────────────────────────────

	test("deletes timeout for the exact skill command and logs telemetry", async () => {
		const input = { command: SKILL_CMD, timeout: 60 };
		await handlers["tool_call"](
			{ toolName: "bash", input, toolCallId: "tc-1" },
			{},
		);
		expect(input.timeout).toBeUndefined();
		expect(appendMock).toHaveBeenCalledTimes(1);
		expect(appendMock.mock.calls[0][0]).toBe("timeout_stripped");
		expect(appendMock.mock.calls[0][1]).toMatchObject({
			originalTimeout: 60,
			parentModel: "m-filter",
			thinkingLevel: "high",
			toolCallId: "tc-1",
		});
	});

	test("works without timeout set (no-op delete) and does not log telemetry", async () => {
		const input: Record<string, any> = { command: SKILL_CMD };
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBeUndefined();
		expect(appendMock).not.toHaveBeenCalled();
	});

	test("works with zero timeout and logs telemetry", async () => {
		const input = { command: SKILL_CMD, timeout: 0 };
		await handlers["tool_call"](
			{ toolName: "bash", input, toolCallId: "tc-2" },
			{},
		);
		expect(input.timeout).toBeUndefined();
		expect(appendMock).toHaveBeenCalledTimes(1);
		expect(appendMock.mock.calls[0][1].originalTimeout).toBe(0);
	});

	test("matches when command starts with cd ~/", async () => {
		const input = {
			command: "cd ~/.agents/skills/git-commits-push && bun run start",
			timeout: 30,
		};
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBeUndefined();
		expect(appendMock).toHaveBeenCalledTimes(1);
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

	// ── Edge cases ─────────────────────────────────────────────────────────

	test("handles undefined command gracefully", async () => {
		const input = { timeout: 30 };
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBe(30);
		expect(appendMock).not.toHaveBeenCalled();
	});

	test("handles null command gracefully", async () => {
		const input = { command: null, timeout: 30 };
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBe(30);
		expect(appendMock).not.toHaveBeenCalled();
	});
});
