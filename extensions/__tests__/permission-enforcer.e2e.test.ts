import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
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

	test("prompt state controls restricted tool execution across turns", () => {
		const statePath = join(tmpDir, "state.json");
		const telemetryBaseDir = join(tmpDir, "stats");
		const script = `
			import { readFileSync } from "node:fs";
			import { join } from "node:path";
			import { isPermissionGranted } from "/Users/famillesendrison/.agents/agent-enforcers/permission-enforcer/src/core/state.ts";
			import { importPiExtension } from "/Users/famillesendrison/.pi/agent/extensions/__tests__/pi-extension-loader.ts";

			const commandValidatorExt = await importPiExtension("command-validator.ts");
			const permissionEnforcerExt = await importPiExtension("permission-enforcer.ts");

			const handlers = {};
			const piMock = {
				on(event, cb) {
					handlers[event] = [...(handlers[event] ?? []), cb];
				},
			};

			permissionEnforcerExt(piMock);
			commandValidatorExt(piMock);

			async function emitBeforeAgentStart(prompt) {
				for (const handler of handlers.before_agent_start ?? []) {
					await handler({ prompt });
				}
			}

			async function emitThinkingLevelSelect(level) {
				for (const handler of handlers.thinking_level_select ?? []) {
					await handler({ level });
				}
			}

			async function emitToolCall(event) {
				let lastResult;
				for (const handler of handlers.tool_call ?? []) {
					const result = await handler(event, {});
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

			await emitThinkingLevelSelect("e2e-thinking");
			await emitBeforeAgentStart("continue without file changes");
			const grantedBeforeGo = isPermissionGranted();
			const blockedBeforeGo = await emitToolCall(restrictedToolCall);

			await emitBeforeAgentStart("please /go implement it");
			const grantedAfterGo = isPermissionGranted();
			const allowedAfterGo = await emitToolCall(restrictedToolCall);

			await emitBeforeAgentStart("continue now");
			const grantedAfterReset = isPermissionGranted();
			const blockedAfterReset = await emitToolCall(restrictedToolCall);

			console.log(JSON.stringify({
				grantedBeforeGo,
				blockedBeforeGo,
				grantedAfterGo,
				allowedAfterGo,
				grantedAfterReset,
				blockedAfterReset,
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

		expect(result.status).toBe(0);
		expect(result.stderr).toBe("");

		const output = JSON.parse(result.stdout) as {
			grantedBeforeGo: boolean;
			blockedBeforeGo: { block: boolean; reason: string };
			grantedAfterGo: boolean;
			allowedAfterGo?: unknown;
			grantedAfterReset: boolean;
			blockedAfterReset: { block: boolean; reason: string };
			permissionEvents: Array<Record<string, unknown>>;
			validatorEvents: Array<Record<string, unknown>>;
		};

		expect(output.grantedBeforeGo).toBe(false);
		expect(output.blockedBeforeGo).toEqual({
			block: true,
			reason: "❌ Permission denied. You cannot implement code without explicit permission. Ask the user to type '/go' to authorize implementation.",
		});
		expect(output.grantedAfterGo).toBe(true);
		expect(output.allowedAfterGo).toBeUndefined();
		expect(output.grantedAfterReset).toBe(false);
		expect(output.blockedAfterReset).toEqual({
			block: true,
			reason: "❌ Permission denied. You cannot implement code without explicit permission. Ask the user to type '/go' to authorize implementation.",
		});

		expect(
			output.permissionEvents.map(
				(event) => (event.details as Record<string, unknown>).granted,
			),
		).toEqual([false, true, false]);
		expect(
			output.validatorEvents.map(
				(event) => (event.details as Record<string, unknown>).action,
			),
		).toEqual(["deny", "allow", "deny"]);
		expect(JSON.stringify(output.permissionEvents)).not.toContain(
			"please /go implement it",
		);
	}, 15000);
});
