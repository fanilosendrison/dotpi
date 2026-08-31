import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { pathToFileURL } from "node:url";

interface ProbeOutput {
	granted: boolean;
	handlerCounts: Record<string, number>;
	event: {
		agent: unknown;
		namespace: unknown;
		eventType: unknown;
		details: Record<string, unknown>;
	};
}

describe("permission-enforcer Pi extension integration", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "permission-enforcer-integration-"));
	});

	afterEach(() => {
		if (existsSync(tmpDir)) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("writes real state and real telemetry for prompt lifecycle", () => {
		const statePath = join(tmpDir, "state.json");
		const telemetryBaseDir = join(tmpDir, "stats");
		const gatewayRoot = join(homedir(), ".pi", "agent");
		const loaderUrl = pathToFileURL(
			join(
				gatewayRoot,
				"extensions",
				"__tests__",
				"node-parity",
				"pi-extension-loader.node.ts",
			),
		).href;
		const script = `
			import { readFileSync } from "node:fs";
			import { join } from "node:path";
			const { importAgentModule, importPiExtension } = await import(${JSON.stringify(loaderUrl)});
			const { isPermissionGrantedForScope } = await importAgentModule(
				"agent-enforcers",
				"permission-enforcer",
				"src",
				"core",
				"state.ts",
			);

			const permissionEnforcerExt = await importPiExtension("permission-enforcer.ts");
			const scope = { agent: "pi", sessionId: "pi-integration-session" };
			const ctx = {
				sessionManager: {
					getSessionId: () => scope.sessionId,
				},
			};

			const handlers = {};
			const piMock = {
				on(event, cb) {
					handlers[event] = [...(handlers[event] ?? []), cb];
				},
			};

			permissionEnforcerExt(piMock);
			await handlers.thinking_level_select[0]({ level: "integration-thinking" });
			await handlers.before_agent_start[0]({ prompt: "please /go ahead" }, ctx);

			const eventsPath = join(
				process.env.PI_TELEMETRY_BASE_DIR,
				"permission-enforcer",
				"events.jsonl",
			);
			const events = readFileSync(eventsPath, "utf-8")
				.trim()
				.split("\\n")
				.filter(Boolean)
				.map((line) => JSON.parse(line));

			console.log(JSON.stringify({
				granted: isPermissionGrantedForScope(scope),
				handlerCounts: {
					beforeAgentStart: handlers.before_agent_start?.length ?? 0,
					beforeProviderRequest: handlers.before_provider_request?.length ?? 0,
					thinkingLevelSelect: handlers.thinking_level_select?.length ?? 0,
				},
				event: events[0],
			}));
		`;

		const result = spawnSync(
			process.execPath,
			[
				"--preserve-symlinks",
				"--preserve-symlinks-main",
				"--input-type=module",
				"--eval",
				script,
			],
			{
				cwd: gatewayRoot,
				encoding: "utf-8",
				env: {
					...process.env,
					PERMISSION_STATE_PATH: statePath,
					PI_TELEMETRY_BASE_DIR: telemetryBaseDir,
				},
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
		assert.strictEqual(result.stderr, "");

		const output = JSON.parse(result.stdout) as ProbeOutput;
		const details = output.event.details;

		assert.strictEqual(output.granted, true);
		assert.deepStrictEqual(output.handlerCounts, {
			beforeAgentStart: 1,
			beforeProviderRequest: 1,
			thinkingLevelSelect: 1,
		});
		assert.strictEqual(output.event.agent, "pi");
		assert.strictEqual(output.event.namespace, "permission-enforcer");
		assert.strictEqual(output.event.eventType, "permission_state_change");
		assert.strictEqual(details.granted, true);
		assert.strictEqual(details.matchSource, "slash");
		assert.strictEqual(details.permissionScope, "pi:pi-integration-session");
		assert.strictEqual(details.promptLength, "please /go ahead".length);
		assert.strictEqual(details.parentModel, "unknown");
		assert.strictEqual(details.thinkingLevel, "integration-thinking");
		assert.strictEqual(details.promptSnippet, undefined);
		assert.ok(!JSON.stringify(output.event).includes("please /go ahead"));
	});
});
