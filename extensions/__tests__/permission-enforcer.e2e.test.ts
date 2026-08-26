import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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

	test("prompt state is isolated across active Pi sessions", () => {
		const statePath = join(tmpDir, "state.json");
		const telemetryBaseDir = join(tmpDir, "stats");
		const script = `
			import { readFileSync } from "node:fs";
			import { join } from "node:path";
			import { isPermissionGrantedForScope } from "/Users/famillesendrison/.agents/agent-enforcers/permission-enforcer/src/core/state.ts";
			import { importPiExtension } from "/Users/famillesendrison/.pi/agent/extensions/__tests__/pi-extension-loader.ts";

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

		const result = spawnSync("bun", ["--eval", script], {
			cwd: "/Users/famillesendrison/.pi/agent",
			encoding: "utf-8",
			env: {
				...process.env,
				PERMISSION_STATE_PATH: statePath,
				PI_TELEMETRY_BASE_DIR: telemetryBaseDir,
			},
		});

		if (result.status !== 0) {
			throw new Error(
				[
					`probe failed with status ${result.status} and signal ${result.signal ?? "none"}`,
					`stdout:\n${result.stdout || "<empty>"}`,
					`stderr:\n${result.stderr || "<empty>"}`,
				].join("\n"),
			);
		}
		expect(result.stderr).toBe("");

		const output = JSON.parse(result.stdout) as {
			sessionAGrantedAfterGo: boolean;
			sessionAAllowedAfterGo?: unknown;
			sessionBDeniedAfterPlainPrompt: boolean;
			sessionBBlockedAfterPlainPrompt: { block: boolean; reason: string };
			sessionAStillGrantedAfterSessionBReset: boolean;
			sessionAAllowedAfterSessionBReset?: unknown;
			sessionADeniedAfterOwnReset: boolean;
			sessionABlockedAfterOwnReset: { block: boolean; reason: string };
			permissionEvents: Array<Record<string, unknown>>;
			validatorEvents: Array<Record<string, unknown>>;
		};

		expect(output.sessionAGrantedAfterGo).toBe(true);
		expect(output.sessionAAllowedAfterGo).toBeUndefined();
		expect(output.sessionBDeniedAfterPlainPrompt).toBe(false);
		expect(output.sessionBBlockedAfterPlainPrompt).toEqual({
			block: true,
			reason: "❌ Permission denied. You cannot implement code without explicit permission. Ask the user to type '/go' to authorize implementation.",
		});
		expect(output.sessionAStillGrantedAfterSessionBReset).toBe(true);
		expect(output.sessionAAllowedAfterSessionBReset).toBeUndefined();
		expect(output.sessionADeniedAfterOwnReset).toBe(false);
		expect(output.sessionABlockedAfterOwnReset).toEqual({
			block: true,
			reason: "❌ Permission denied. You cannot implement code without explicit permission. Ask the user to type '/go' to authorize implementation.",
		});

		expect(
			output.permissionEvents.map(
				(event) => (event.details as Record<string, unknown>).granted,
			),
		).toEqual([true, false, false]);
		expect(
			output.permissionEvents.map(
				(event) => (event.details as Record<string, unknown>).permissionScope,
			),
		).toEqual(["pi:session-a", "pi:session-b", "pi:session-a"]);
		expect(
			output.validatorEvents.map(
				(event) => (event.details as Record<string, unknown>).action,
			),
		).toEqual(["allow", "deny", "allow", "deny"]);
		expect(
			output.validatorEvents.map(
				(event) => (event.details as Record<string, unknown>).permissionScope,
			),
		).toEqual([
			"pi:session-a",
			"pi:session-b",
			"pi:session-a",
			"pi:session-a",
		]);
		expect(JSON.stringify(output.permissionEvents)).not.toContain(
			"please /go implement it",
		);
	}, 15000);
});
