import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { importPiExtension } from "./pi-extension-loader.node.ts";

const SKILL_CMD =
	"cd /Users/famillesendrison/.agents/skills/git-commits-push && bun run start";

interface ToolCallEvent {
	toolName: string;
	input: Record<string, unknown>;
	toolCallId?: string;
}

type ToolCallHandler = (
	event: ToolCallEvent,
	context: Record<string, never>,
) => Promise<unknown> | unknown;

type ExtensionFactory = (pi: {
	on: (event: string, handler: ToolCallHandler) => void;
}) => void;

interface TelemetryEvent {
	eventType: string;
	details: Record<string, unknown>;
}

describe("zero-timeout-filter", () => {
	let tmpDir: string;
	let originalStatsDir: string | undefined;
	let handlers: Record<string, ToolCallHandler>;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "zero-timeout-filter-"));
		originalStatsDir = process.env.ZERO_TIMEOUT_FILTER_STATS_DIR;
		process.env.ZERO_TIMEOUT_FILTER_STATS_DIR = tmpDir;
		handlers = {};

		const zeroTimeoutFilter = await importPiExtension<ExtensionFactory>(
			"zero-timeout-filter.ts",
		);
		zeroTimeoutFilter({
			on: (event, handler) => {
				handlers[event] = handler;
			},
		});
	});

	afterEach(() => {
		if (originalStatsDir === undefined) {
			delete process.env.ZERO_TIMEOUT_FILTER_STATS_DIR;
		} else {
			process.env.ZERO_TIMEOUT_FILTER_STATS_DIR = originalStatsDir;
		}
		if (existsSync(tmpDir)) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	function readEvents(): TelemetryEvent[] {
		const eventsPath = join(tmpDir, "events.jsonl");
		if (!existsSync(eventsPath)) return [];
		return readFileSync(eventsPath, "utf-8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as TelemetryEvent);
	}

	test("registers tool_call handler", () => {
		assert.notStrictEqual(handlers.tool_call, undefined);
	});

	test("ignores non-bash tools", async () => {
		const input = { command: SKILL_CMD, timeout: 30 };
		await handlers.tool_call({ toolName: "write", input }, {});
		assert.strictEqual(input.timeout, 30);
		assert.strictEqual(readEvents().length, 0);
	});

	test("ignores bash commands that are not the skill", async () => {
		const input = { command: "echo hello", timeout: 30 };
		await handlers.tool_call({ toolName: "bash", input }, {});
		assert.strictEqual(input.timeout, 30);
		assert.strictEqual(readEvents().length, 0);
	});

	test("ignores git commit commands", async () => {
		const input = {
			command: "git commit -m 'feat: x' && git push",
			timeout: 30,
		};
		await handlers.tool_call({ toolName: "bash", input }, {});
		assert.strictEqual(input.timeout, 30);
		assert.strictEqual(readEvents().length, 0);
	});

	test("ignores /git-commits-push command", async () => {
		const input = { command: "/git-commits-push", timeout: 30 };
		await handlers.tool_call({ toolName: "bash", input }, {});
		assert.strictEqual(input.timeout, 30);
		assert.strictEqual(readEvents().length, 0);
	});

	test("deletes timeout for the exact skill command and logs telemetry", async () => {
		const input: Record<string, unknown> = { command: SKILL_CMD, timeout: 60 };
		await handlers.tool_call(
			{ toolName: "bash", input, toolCallId: "tc-1" },
			{},
		);

		const events = readEvents();
		assert.strictEqual(input.timeout, undefined);
		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0].eventType, "timeout_stripped");
		assert.partialDeepStrictEqual(events[0].details, {
			originalTimeout: 60,
			toolCallId: "tc-1",
		});
	});

	test("works without timeout set and does not log telemetry", async () => {
		const input: Record<string, unknown> = { command: SKILL_CMD };
		await handlers.tool_call({ toolName: "bash", input }, {});
		assert.strictEqual(input.timeout, undefined);
		assert.strictEqual(readEvents().length, 0);
	});

	test("works with zero timeout and logs telemetry", async () => {
		const input: Record<string, unknown> = { command: SKILL_CMD, timeout: 0 };
		await handlers.tool_call(
			{ toolName: "bash", input, toolCallId: "tc-2" },
			{},
		);

		const events = readEvents();
		assert.strictEqual(input.timeout, undefined);
		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0].details.originalTimeout, 0);
	});

	test("matches when command starts with cd ~/", async () => {
		const input: Record<string, unknown> = {
			command: "cd ~/.agents/skills/git-commits-push && bun run start",
			timeout: 30,
		};
		await handlers.tool_call({ toolName: "bash", input }, {});
		assert.strictEqual(input.timeout, undefined);
		assert.strictEqual(readEvents().length, 1);
	});

	test("does not mutate other input fields", async () => {
		const input: Record<string, unknown> = {
			command: SKILL_CMD,
			timeout: 60,
			cwd: "/tmp",
			extra: "preserved",
		};
		await handlers.tool_call({ toolName: "bash", input }, {});
		assert.strictEqual(input.cwd, "/tmp");
		assert.strictEqual(input.extra, "preserved");
	});

	test("handles undefined command gracefully", async () => {
		const input = { timeout: 30 };
		await handlers.tool_call({ toolName: "bash", input }, {});
		assert.strictEqual(input.timeout, 30);
		assert.strictEqual(readEvents().length, 0);
	});

	test("handles null command gracefully", async () => {
		const input = { command: null, timeout: 30 };
		await handlers.tool_call({ toolName: "bash", input }, {});
		assert.strictEqual(input.timeout, 30);
		assert.strictEqual(readEvents().length, 0);
	});
});
