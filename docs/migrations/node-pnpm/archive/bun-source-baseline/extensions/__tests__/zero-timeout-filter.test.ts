import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importPiExtension } from "./pi-extension-loader";

const SKILL_CMD =
	"cd /Users/famillesendrison/.agents/skills/git-commits-push && bun run start";
const PNPM_SKILL_CMD =
	'cd "$HOME/.agents/skills/git-commits-push" && pnpm --silent run start';

type ExtensionFactory = (pi: {
	on: (event: string, cb: Function) => void;
}) => void;

interface TelemetryEvent {
	eventType: string;
	details: Record<string, unknown>;
}

describe("zero-timeout-filter", () => {
	let tmpDir: string;
	let originalStatsDir: string | undefined;
	let handlers: Record<string, Function>;

	beforeEach(async () => {
		tmpDir = mkdtempSync(join(tmpdir(), "zero-timeout-filter-"));
		originalStatsDir = process.env.ZERO_TIMEOUT_FILTER_STATS_DIR;
		process.env.ZERO_TIMEOUT_FILTER_STATS_DIR = tmpDir;
		handlers = {};

		const zeroTimeoutFilter =
			await importPiExtension<ExtensionFactory>("zero-timeout-filter.ts");
		zeroTimeoutFilter({
			on: (event: string, cb: Function) => {
				handlers[event] = cb;
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
		expect(handlers["tool_call"]).toBeDefined();
	});

	test("ignores non-bash tools", async () => {
		const input = { command: SKILL_CMD, timeout: 30 };
		await handlers["tool_call"]({ toolName: "write", input }, {});
		expect(input.timeout).toBe(30);
		expect(readEvents()).toHaveLength(0);
	});

	test("ignores bash commands that are not the skill", async () => {
		const input = { command: "echo hello", timeout: 30 };
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBe(30);
		expect(readEvents()).toHaveLength(0);
	});

	test("ignores git commit commands", async () => {
		const input = {
			command: "git commit -m 'feat: x' && git push",
			timeout: 30,
		};
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBe(30);
		expect(readEvents()).toHaveLength(0);
	});

	test("ignores /git-commits-push command", async () => {
		const input = { command: "/git-commits-push", timeout: 30 };
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBe(30);
		expect(readEvents()).toHaveLength(0);
	});

	test("deletes timeout for the exact skill command and logs telemetry", async () => {
		const input = { command: SKILL_CMD, timeout: 60 };
		await handlers["tool_call"](
			{ toolName: "bash", input, toolCallId: "tc-1" },
			{},
		);

		const events = readEvents();
		expect(input.timeout).toBeUndefined();
		expect(events).toHaveLength(1);
		expect(events[0].eventType).toBe("timeout_stripped");
		expect(events[0].details).toMatchObject({
			originalTimeout: 60,
			toolCallId: "tc-1",
		});
	});

	test("deletes timeout for canonical pnpm launch", async () => {
		const input = { command: PNPM_SKILL_CMD, timeout: 45 };
		await handlers["tool_call"](
			{ toolName: "bash", input, toolCallId: "tc-pnpm" },
			{},
		);

		const events = readEvents();
		expect(input.timeout).toBeUndefined();
		expect(events).toHaveLength(1);
		expect(events[0].details).toMatchObject({
			originalTimeout: 45,
			toolCallId: "tc-pnpm",
		});
	});

	test("ignores incomplete and unsafe launch commands", async () => {
		for (const command of [
			"cd ~/.agents/skills/git-commits-push && pnpm run start",
			`${PNPM_SKILL_CMD} && git push`,
		]) {
			const input = { command, timeout: 30 };
			await handlers["tool_call"]({ toolName: "bash", input }, {});
			expect(input.timeout).toBe(30);
		}
		expect(readEvents()).toHaveLength(0);
	});

	test("works without timeout set and does not log telemetry", async () => {
		const input: Record<string, unknown> = { command: SKILL_CMD };
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBeUndefined();
		expect(readEvents()).toHaveLength(0);
	});

	test("works with zero timeout and logs telemetry", async () => {
		const input = { command: SKILL_CMD, timeout: 0 };
		await handlers["tool_call"](
			{ toolName: "bash", input, toolCallId: "tc-2" },
			{},
		);

		const events = readEvents();
		expect(input.timeout).toBeUndefined();
		expect(events).toHaveLength(1);
		expect(events[0].details.originalTimeout).toBe(0);
	});

	test("matches when command starts with cd ~/", async () => {
		const input = {
			command: "cd ~/.agents/skills/git-commits-push && bun run start",
			timeout: 30,
		};
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBeUndefined();
		expect(readEvents()).toHaveLength(1);
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

	test("handles undefined command gracefully", async () => {
		const input = { timeout: 30 };
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBe(30);
		expect(readEvents()).toHaveLength(0);
	});

	test("handles null command gracefully", async () => {
		const input = { command: null, timeout: 30 };
		await handlers["tool_call"]({ toolName: "bash", input }, {});
		expect(input.timeout).toBe(30);
		expect(readEvents()).toHaveLength(0);
	});
});
