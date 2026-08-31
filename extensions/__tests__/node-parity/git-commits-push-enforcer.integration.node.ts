import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";

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

const PROBE_LOADER_PATH = join(
	homedir(),
	".pi",
	"agent",
	"extensions",
	"__tests__",
	"node-parity",
	"pi-extension-loader.node.ts",
);

const PROBE_SOURCE = `
import { pathToFileURL } from "node:url";

const loaderPath = process.env.PROBE_LOADER_PATH;
if (!loaderPath) throw new Error("missing PROBE_LOADER_PATH");

const { importPiExtension } = await import(pathToFileURL(loaderPath).href);
const pushEnforcerExt = await importPiExtension("git-commits-push-enforcer.ts");
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
		const env: NodeJS.ProcessEnv = {
			...process.env,
			PI_TELEMETRY_BASE_DIR: statsBaseDir,
			PROBE_LOADER_PATH,
			PROBE_COMMAND: command,
			PROBE_TOOL_CALL_ID: options?.toolCallId ?? "call-probe",
		};
		if (options?.bypass) {
			env.BYPASS_GIT_ENFORCER = "1";
		} else {
			delete env.BYPASS_GIT_ENFORCER;
		}

		const result = spawnSync(
			process.execPath,
			[
				"--preserve-symlinks",
				"--preserve-symlinks-main",
				"--input-type=module",
				"--eval",
				PROBE_SOURCE,
			],
			{
				encoding: "utf-8",
				env,
			},
		);

		if (result.status !== 0) {
			throw new Error(
				[
					`probe failed with status ${result.status} and signal ${result.signal ?? "none"}`,
					`stdout:\n${result.stdout || "<empty>"}`,
					`stderr:\n${result.stderr || "<empty>"}`,
				].join("\n"),
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

		assert.ok(
			output.result?.block === true &&
				output.result.reason?.includes("Use /git-commits-push") === true,
		);

		const events = readEvents();
		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0]?.eventType, "blocked");
		assert.strictEqual(events[0]?.agent, "pi");
		assert.strictEqual(events[0]?.namespace, "git-commits-push-enforcer");
		assert.partialDeepStrictEqual(events[0]?.details, {
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

			assert.partialDeepStrictEqual(output.result, { block: true });
			const events = readEvents();
			assert.strictEqual(events.length, eventsBefore.length + 1);
			assert.strictEqual(events.at(-1)?.eventType, "blocked");
			assert.partialDeepStrictEqual(events.at(-1)?.details, {
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

		assert.strictEqual(output.result, undefined);
		const events = readEvents();
		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0]?.eventType, "skipped");
		assert.partialDeepStrictEqual(events[0]?.details, {
			rawCommand: "git commit -m 'fix: bypass'",
			detectedBy: "git-commit",
			toolCallId: "call-bypass",
			mutation: "commit",
			reason: "bypass-enforcer",
		});
	});

	test("allows skill launch and writes real enforcer_triggered telemetry", () => {
		const command =
			'cd "$HOME/.agents/skills/git-commits-push" && pnpm --silent run start';
		const output = runProbe(command, { toolCallId: "call-real-skill" });

		assert.strictEqual(output.result, undefined);
		assert.strictEqual(output.piParentModel, "test-model-enforcer");
		assert.notStrictEqual(output.piSessionId, undefined);

		const events = readEvents();
		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0]?.eventType, "enforcer_triggered");
		assert.partialDeepStrictEqual(events[0]?.details, {
			rawCommand: command,
			detectedBy: "git-commits-push",
			toolCallId: "call-real-skill",
			parentModel: "test-model-enforcer",
			thinkingLevel: "low",
		});
		assert.strictEqual(events[0]?.details.mutation, undefined);
	});

	test("ignores quoted raw git text without writing telemetry", () => {
		const output = runProbe("rg -n 'git commit' /tmp", {
			toolCallId: "call-search",
		});

		assert.strictEqual(output.result, undefined);
		assert.strictEqual(readEvents().length, 0);
	});
});
