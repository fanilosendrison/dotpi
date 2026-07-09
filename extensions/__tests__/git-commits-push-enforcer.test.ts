import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";

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

import pushEnforcerExt from "../git-commits-push-enforcer";

afterAll(() => {
	mock.restore();
});

describe("git-commits-push-enforcer Pi extension", () => {
	const handlers: Record<string, Function> = {};

	const piMock = {
		on: (event: string, cb: Function) => {
			handlers[event] = cb;
		},
	};

	pushEnforcerExt(piMock as any);

	beforeEach(() => {
		appendMock.mockClear();
	});

	// ── Handler registration ───────────────────────────────────────────────

	test("registers tool_call handler", () => {
		expect(handlers["tool_call"]).toBeDefined();
	});

	// ── tool_call ──────────────────────────────────────────────────────────

	describe("tool_call", () => {
		const h = () => handlers["tool_call"];

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

		test("processes git commit commands", async () => {
			const result = await h()(
				{
					toolName: "bash",
					input: { command: "git commit -m 'feat: add x' && git push" },
				},
				{},
			);
			expect(result).toBeUndefined();
			expect(appendMock).toHaveBeenCalledTimes(1);
			expect(appendMock.mock.calls[0][0]).toBe("enforcer_triggered");
			expect(appendMock.mock.calls[0][1]).toMatchObject({
				rawCommand: "git commit -m 'feat: add x' && git push",
				detectedBy: "git-commit",
				parentModel: "test-model-enforcer",
				thinkingLevel: "low",
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
