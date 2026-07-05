import { describe, expect, test } from "bun:test";
import pushEnforcerExt from "../git-commits-push-enforcer";

describe("git-commits-push-enforcer Pi extension", () => {
	const handlers: Record<string, Function> = {};

	const piMock = {
		on: (event: string, cb: Function) => {
			handlers[event] = cb;
		},
	};

	pushEnforcerExt(piMock as any);

	// ── Handler registration ───────────────────────────────────────────────

	test("registers tool_call handler", () => {
		expect(handlers["tool_call"]).toBeDefined();
	});

	test("registers before_provider_request handler", () => {
		expect(handlers["before_provider_request"]).toBeDefined();
	});

	test("does NOT register tool_execution_start", () => {
		expect(handlers["tool_execution_start"]).toBeUndefined();
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
		});

		test("ignores non-commit bash commands", async () => {
			const result = await h()(
				{ toolName: "bash", input: { command: "ls -la" } },
				{},
			);
			expect(result).toBeUndefined();
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
		});
	});
});
