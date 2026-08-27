import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { pathToFileURL } from "node:url";

interface BlockResult {
	block: boolean;
	reason: string;
}

interface ProbeOutput {
	sessionAGrantedAfterGo: boolean;
	sessionAAllowedAfterGo?: unknown;
	sessionBDeniedAfterPlainPrompt: boolean;
	sessionBBlockedAfterPlainPrompt: BlockResult;
	sessionAStillGrantedAfterSessionBReset: boolean;
	sessionAAllowedAfterSessionBReset?: unknown;
	sessionADeniedAfterOwnReset: boolean;
	sessionABlockedAfterOwnReset: BlockResult;
	permissionEvents: Array<Record<string, unknown>>;
	validatorEvents: Array<Record<string, unknown>>;
}

const PERMISSION_DENIED_REASON =
	"❌ Permission denied. You cannot implement code without explicit permission. Ask the user to type '/go' to authorize implementation. Never attempt to bypass this restriction.";

describe("permission-enforcer and command-validator E2E", () => {
	let tmpDir: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "permission-enforcer-e2e-"));
	});

	afterEach(() => {
		if (existsSync(tmpDir)) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	test("prompt state is isolated across active Pi sessions", {
		timeout: 15_000,
	}, () => {
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

				const commandValidatorExt = await importPiExtension("command-validator.ts");
				const permissionEnforcerExt = await importPiExtension("permission-enforcer.ts");

				function createRuntime(sessionId) {
					const handlers = {};
					const piMock = {
						on(event, cb) {
							handlers[event] = [...(handlers[event] ?? []), cb];
						},
					};
					const ctx = {
						sessionManager: {
							getSessionId: () => sessionId,
						},
						ui: {
							confirm: async () => true,
						},
					};

					permissionEnforcerExt(piMock);
					commandValidatorExt(piMock);

					return {
						handlers,
						ctx,
						scope: { agent: "pi", sessionId },
					};
				}

				async function emitBeforeAgentStart(runtime, prompt) {
					for (const handler of runtime.handlers.before_agent_start ?? []) {
						await handler({ prompt }, runtime.ctx);
					}
				}

				async function emitThinkingLevelSelect(runtime, level) {
					for (const handler of runtime.handlers.thinking_level_select ?? []) {
						await handler({ level });
					}
				}

				async function emitToolCall(runtime, event) {
					let lastResult;
					for (const handler of runtime.handlers.tool_call ?? []) {
						const result = await handler(event, runtime.ctx);
						if (result?.block) return result;
						lastResult = result;
					}
					return lastResult;
				}

				function readEvents(namespace) {
					const eventsPath = join(
						process.env.PI_TELEMETRY_BASE_DIR,
						namespace,
						"events.jsonl",
					);
					return readFileSync(eventsPath, "utf-8")
						.trim()
						.split("\\n")
						.filter(Boolean)
						.map((line) => JSON.parse(line));
				}

				const restrictedToolCall = {
					toolName: "write_to_file",
					input: { TargetFile: "/tmp/e2e-test" },
				};

				const sessionA = createRuntime("session-a");
				const sessionB = createRuntime("session-b");

				await emitThinkingLevelSelect(sessionA, "e2e-thinking");
				await emitThinkingLevelSelect(sessionB, "e2e-thinking");

				await emitBeforeAgentStart(sessionA, "please /go implement it");
				const sessionAGrantedAfterGo = isPermissionGrantedForScope(sessionA.scope);
				const sessionAAllowedAfterGo = await emitToolCall(sessionA, restrictedToolCall);

				await emitBeforeAgentStart(sessionB, "continue without file changes");
				const sessionBDeniedAfterPlainPrompt = isPermissionGrantedForScope(sessionB.scope);
				const sessionBBlockedAfterPlainPrompt = await emitToolCall(sessionB, restrictedToolCall);

				const sessionAStillGrantedAfterSessionBReset = isPermissionGrantedForScope(sessionA.scope);
				const sessionAAllowedAfterSessionBReset = await emitToolCall(sessionA, restrictedToolCall);

				await emitBeforeAgentStart(sessionA, "continue now");
				const sessionADeniedAfterOwnReset = isPermissionGrantedForScope(sessionA.scope);
				const sessionABlockedAfterOwnReset = await emitToolCall(sessionA, restrictedToolCall);

				console.log(JSON.stringify({
					sessionAGrantedAfterGo,
					sessionAAllowedAfterGo,
					sessionBDeniedAfterPlainPrompt,
					sessionBBlockedAfterPlainPrompt,
					sessionAStillGrantedAfterSessionBReset,
					sessionAAllowedAfterSessionBReset,
					sessionADeniedAfterOwnReset,
					sessionABlockedAfterOwnReset,
					permissionEvents: readEvents("permission-enforcer"),
					validatorEvents: readEvents("command-validator"),
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

		assert.strictEqual(output.sessionAGrantedAfterGo, true);
		assert.strictEqual(output.sessionAAllowedAfterGo, undefined);
		assert.strictEqual(output.sessionBDeniedAfterPlainPrompt, false);
		assert.deepStrictEqual(output.sessionBBlockedAfterPlainPrompt, {
			block: true,
			reason: PERMISSION_DENIED_REASON,
		});
		assert.strictEqual(output.sessionAStillGrantedAfterSessionBReset, true);
		assert.strictEqual(output.sessionAAllowedAfterSessionBReset, undefined);
		assert.strictEqual(output.sessionADeniedAfterOwnReset, false);
		assert.deepStrictEqual(output.sessionABlockedAfterOwnReset, {
			block: true,
			reason: PERMISSION_DENIED_REASON,
		});

		assert.deepStrictEqual(
			output.permissionEvents.map(
				(event) => (event.details as Record<string, unknown>).granted,
			),
			[true, false, false],
		);
		assert.deepStrictEqual(
			output.permissionEvents.map(
				(event) => (event.details as Record<string, unknown>).permissionScope,
			),
			["pi:session-a", "pi:session-b", "pi:session-a"],
		);
		assert.deepStrictEqual(
			output.validatorEvents.map(
				(event) => (event.details as Record<string, unknown>).action,
			),
			["allow", "deny", "allow", "deny"],
		);
		assert.deepStrictEqual(
			output.validatorEvents.map(
				(event) => (event.details as Record<string, unknown>).permissionScope,
			),
			["pi:session-a", "pi:session-b", "pi:session-a", "pi:session-a"],
		);
		assert.ok(
			!JSON.stringify(output.permissionEvents).includes(
				"please /go implement it",
			),
		);
	});
});
