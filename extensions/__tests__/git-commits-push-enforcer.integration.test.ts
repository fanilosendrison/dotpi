import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface ProbeResult {
	result?: {
		block?: boolean;
		reason?: string;
	};
	piParentModel?: string;
	piSessionId?: string;
}

interface TelemetryEvent {
	eventType: string;
	agent: string;
	namespace: string;
	details: Record<string, unknown>;
}

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const EXTENSION_PATH = join(TEST_DIR, "../git-commits-push-enforcer.ts");
const PROBE_SOURCE = `
import { pathToFileURL } from "node:url";

const extensionPath = process.env.PROBE_EXTENSION_PATH;
if (!extensionPath) throw new Error("missing PROBE_EXTENSION_PATH");

const { default: pushEnforcerExt } = await import(pathToFileURL(extensionPath).href);
const handlers = {};
const piMock = {
  on: (event, cb) => {
    handlers[event] = cb;
  },
};

pushEnforcerExt(piMock);
await handlers.before_provider_request?.({ payload: { model: "test-model-enforcer" } }, {});
await handlers.thinking_level_select?.({ level: "low" }, {});

const result = await handlers.tool_call(
  {
    toolName: "bash",
    toolCallId: process.env.PROBE_TOOL_CALL_ID,
    input: { command: process.env.PROBE_COMMAND },
  },
  {},
);

process.stdout.write(JSON.stringify({
  result,
  piParentModel: process.env.PI_PARENT_MODEL,
  piSessionId: process.env.PI_SESSION_ID,
}));
`;

describe("git-commits-push-enforcer Pi extension integration", () => {
	let tmpDir: string;
	let statsBaseDir: string;
	let originalTelemetryBaseDir: string | undefined;
	let originalBypass: string | undefined;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pi-gcpe-integration-"));
		statsBaseDir = join(tmpDir, "stats");
		originalTelemetryBaseDir = process.env.PI_TELEMETRY_BASE_DIR;
		originalBypass = process.env.BYPASS_GIT_ENFORCER;
		delete process.env.BYPASS_GIT_ENFORCER;
		delete process.env.PI_PARENT_MODEL;
		delete process.env.PI_SESSION_ID;
	});

	afterEach(() => {
		if (originalTelemetryBaseDir === undefined) {
			delete process.env.PI_TELEMETRY_BASE_DIR;
		} else {
			process.env.PI_TELEMETRY_BASE_DIR = originalTelemetryBaseDir;
		}
		if (originalBypass === undefined) {
			delete process.env.BYPASS_GIT_ENFORCER;
		} else {
			process.env.BYPASS_GIT_ENFORCER = originalBypass;
		}
		delete process.env.PI_PARENT_MODEL;
		delete process.env.PI_SESSION_ID;
		if (existsSync(tmpDir)) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	function runProbe(
		command: string,
		options?: { toolCallId?: string; bypass?: boolean },
	): ProbeResult {
		const env: Record<string, string> = {
			...process.env,
			PI_TELEMETRY_BASE_DIR: statsBaseDir,
			PROBE_EXTENSION_PATH: EXTENSION_PATH,
			PROBE_COMMAND: command,
			PROBE_TOOL_CALL_ID: options?.toolCallId ?? "call-probe",
		};
		if (options?.bypass) {
			env.BYPASS_GIT_ENFORCER = "1";
		} else {
			delete env.BYPASS_GIT_ENFORCER;
		}

		const result = spawnSync("bun", ["--eval", PROBE_SOURCE], {
			encoding: "utf-8",
			env,
		});

		if (result.status !== 0) {
			throw new Error(
				`probe failed with status ${result.status}\n${result.stderr}`,
			);
		}

		return JSON.parse(result.stdout) as ProbeResult;
	}

	function readEvents(): TelemetryEvent[] {
		const eventsPath = join(
			statsBaseDir,
			"git-commits-push-enforcer",
			"events.jsonl",
		);
		if (!existsSync(eventsPath)) return [];

		return readFileSync(eventsPath, "utf-8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as TelemetryEvent);
	}

	test("blocks raw git push and writes real blocked telemetry", () => {
		const output = runProbe("git push origin main", {
			toolCallId: "call-real-push",
		});

		expect(output.result).toMatchObject({
			block: true,
			reason: expect.stringContaining("Use /git-commits-push"),
		});

		const events = readEvents();
		expect(events).toHaveLength(1);
		expect(events[0]?.eventType).toBe("blocked");
		expect(events[0]?.agent).toBe("pi");
		expect(events[0]?.namespace).toBe("git-commits-push-enforcer");
		expect(events[0]?.details).toMatchObject({
			rawCommand: "git push origin main",
			detectedBy: "git-commit",
			toolCallId: "call-real-push",
			parentModel: "test-model-enforcer",
			thinkingLevel: "low",
			mutation: "push",
		});
	});

	test("blocks git -C commit, commit-tree, and push commands", () => {
		for (const [command, mutation] of [
			["git -C /workspace/repo commit -m 'fix: x'", "commit"],
			["git commit-tree HEAD", "commit-tree"],
			["git push origin main", "push"],
		] as const) {
			const eventsBefore = readEvents();
			const output = runProbe(command, { toolCallId: `call-${mutation}` });

			expect(output.result).toMatchObject({ block: true });
			const events = readEvents();
			expect(events).toHaveLength(eventsBefore.length + 1);
			expect(events.at(-1)?.eventType).toBe("blocked");
			expect(events.at(-1)?.details).toMatchObject({
				rawCommand: command,
				detectedBy: "git-commit",
				toolCallId: `call-${mutation}`,
				mutation,
			});
		}
	});

	test("allows raw git mutations only with process-level bypass", () => {
		const output = runProbe("git commit -m 'fix: bypass'", {
			toolCallId: "call-bypass",
			bypass: true,
		});

		expect(output.result).toBeUndefined();
		const events = readEvents();
		expect(events).toHaveLength(1);
		expect(events[0]?.eventType).toBe("skipped");
		expect(events[0]?.details).toMatchObject({
			rawCommand: "git commit -m 'fix: bypass'",
			detectedBy: "git-commit",
			toolCallId: "call-bypass",
			mutation: "commit",
			reason: "bypass-enforcer",
		});
	});

	test("allows skill launch and writes real enforcer_triggered telemetry", () => {
		const command = "cd ~/.agents/skills/git-commits-push && bun run start";
		const output = runProbe(command, { toolCallId: "call-real-skill" });

		expect(output.result).toBeUndefined();
		expect(output.piParentModel).toBe("test-model-enforcer");
		expect(output.piSessionId).toBeDefined();

		const events = readEvents();
		expect(events).toHaveLength(1);
		expect(events[0]?.eventType).toBe("enforcer_triggered");
		expect(events[0]?.details).toMatchObject({
			rawCommand: command,
			detectedBy: "git-commits-push",
			toolCallId: "call-real-skill",
			parentModel: "test-model-enforcer",
			thinkingLevel: "low",
		});
		expect(events[0]?.details.mutation).toBeUndefined();
	});

	test("ignores quoted raw git text without writing telemetry", () => {
		const output = runProbe("rg -n 'git commit' /tmp", {
			toolCallId: "call-search",
		});

		expect(output.result).toBeUndefined();
		expect(readEvents()).toHaveLength(0);
	});
});
