import { describe, expect, test } from "bun:test";
import pushEnforcerExt from "../git-commits-push-enforcer";

describe("git-commits-push-enforcer Pi extension", () => {
	const handlers: Record<string, Function> = {};
	let lastModel: string | undefined;

	const piMock = {
		on: (event: string, cb: Function) => {
			handlers[event] = cb;
		},
	};

	pushEnforcerExt(piMock as any);

	// ── Handler registration ───────────────────────────────────────────────

	test("registers tool_execution_start handler", () => {
		expect(handlers["tool_execution_start"]).toBeDefined();
	});

	test("registers tool_call handler", () => {
		expect(handlers["tool_call"]).toBeDefined();
	});

	test("registers before_provider_request handler", () => {
		expect(handlers["before_provider_request"]).toBeDefined();
	});

	// ── tool_execution_start ───────────────────────────────────────────────

	describe("tool_execution_start", () => {
		const h = () => handlers["tool_execution_start"];

		test("ignores non-bash tools", async () => {
			const result = await h()(
				{ toolName: "write", args: { file_path: "/tmp/x" }, toolCallId: "t1" },
				{},
			);
			expect(result).toBeUndefined();
		});

		test("ignores bash commands that are not commit intents", async () => {
			const result = await h()(
				{ toolName: "bash", args: { command: "ls -la" }, toolCallId: "t2" },
				{},
			);
			expect(result).toBeUndefined();
		});

		test("processes git commit commands", async () => {
			// Should not throw; logs via statsLog internally
			const result = await h()(
				{
					toolName: "bash",
					args: { command: "git commit -m 'feat: add x' && git push" },
					toolCallId: "t3",
				},
				{},
			);
			expect(result).toBeUndefined();
		});

		test("processes git-commits-push commands", async () => {
			const result = await h()(
				{
					toolName: "bash",
					args: { command: "/git-commits-push" },
					toolCallId: "t4",
				},
				{},
			);
			expect(result).toBeUndefined();
		});
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

		test("ignores non-commit bash commands (no block)", async () => {
			const result = await h()(
				{ toolName: "bash", input: { command: "ls -la" } },
				{},
			);
			expect(result).toBeUndefined();
		});

		test("does NOT block any commit intent (routes to skill)", async () => {
			const result = await h()(
				{
					toolName: "bash",
					input: { command: "git commit -m 'random msg' && git push" },
				},
				{},
			);
			// No block — the enforcer lets everything through to the skill
			expect(result).toBeUndefined();
		});

		test("does NOT block git-commits-push invocations", async () => {
			const result = await h()(
				{
					toolName: "bash",
					input: { command: "/git-commits-push" },
				},
				{},
			);
			expect(result).toBeUndefined();
		});

		test("handles git commit without push (no block, routes to skill)", async () => {
			const result = await h()(
				{
					toolName: "bash",
					input: { command: "git commit -m 'feat(api): add x'" },
				},
				{},
			);
			// No longer blocks — the skill handles validation
			expect(result).toBeUndefined();
		});
	});
});
