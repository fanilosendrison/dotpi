import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
		const script = `
			import { readFileSync } from "node:fs";
			import { join } from "node:path";
			import { isPermissionGrantedForScope } from "/Users/famillesendrison/.agents/agent-enforcers/permission-enforcer/src/core/state.ts";
			import { importPiExtension } from "/Users/famillesendrison/.pi/agent/extensions/__tests__/pi-extension-loader.ts";

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
			granted: boolean;
			handlerCounts: Record<string, number>;
			event: Record<string, unknown>;
		};
		const details = output.event.details as Record<string, unknown>;

		expect(output.granted).toBe(true);
		expect(output.handlerCounts).toEqual({
			beforeAgentStart: 1,
			beforeProviderRequest: 1,
			thinkingLevelSelect: 1,
		});
		expect(output.event.agent).toBe("pi");
		expect(output.event.namespace).toBe("permission-enforcer");
		expect(output.event.eventType).toBe("permission_state_change");
		expect(details.granted).toBe(true);
		expect(details.matchSource).toBe("slash");
		expect(details.permissionScope).toBe("pi:pi-integration-session");
		expect(details.promptLength).toBe("please /go ahead".length);
		expect(details.parentModel).toBe("unknown");
		expect(details.thinkingLevel).toBe("integration-thinking");
		expect(details.promptSnippet).toBeUndefined();
		expect(JSON.stringify(output.event)).not.toContain("please /go ahead");
	});
});
