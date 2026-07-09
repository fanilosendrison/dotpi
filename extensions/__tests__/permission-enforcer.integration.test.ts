import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isPermissionGranted } from "/Users/famillesendrison/.agents/agent-enforcers/permission-enforcer/src/core/state.ts";

type ExtensionHandler = (
	event: Record<string, unknown>,
) => Promise<unknown> | unknown;
type HandlerRegistry = Record<string, ExtensionHandler[]>;

const EXTENSION_PATH =
	"/Users/famillesendrison/.pi/agent/extensions/permission-enforcer.ts";
const TELEMETRY_PATH =
	"/Users/famillesendrison/.pi/agent/extensions/shared/pi-telemetry.ts";

function resetRuntimeModules() {
	mock.restore();
	for (const path of [EXTENSION_PATH, TELEMETRY_PATH]) {
		delete require.cache[require.resolve(path)];
	}
}

describe("permission-enforcer Pi extension integration", () => {
	let tmpDir: string;
	let originalTelemetryBaseDir: string | undefined;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "permission-enforcer-integration-"));
		originalTelemetryBaseDir = process.env.PI_TELEMETRY_BASE_DIR;
		process.env.PI_TELEMETRY_BASE_DIR = join(tmpDir, "stats");
		process.env.PERMISSION_STATE_PATH = join(tmpDir, "state.json");
	});

	afterEach(() => {
		if (originalTelemetryBaseDir === undefined) {
			delete process.env.PI_TELEMETRY_BASE_DIR;
		} else {
			process.env.PI_TELEMETRY_BASE_DIR = originalTelemetryBaseDir;
		}
		delete process.env.PERMISSION_STATE_PATH;
		if (existsSync(tmpDir)) {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	async function registerExtension(): Promise<HandlerRegistry> {
		resetRuntimeModules();
		// @ts-ignore: ?real is a Bun feature to bypass module mocks.
		const { default: permissionEnforcerExt } = await import(
			"../permission-enforcer?real"
		);
		const handlers: HandlerRegistry = {};
		const piMock = {
			on: (event: string, cb: ExtensionHandler) => {
				handlers[event] = [...(handlers[event] ?? []), cb];
			},
		};

		permissionEnforcerExt(piMock as unknown as ExtensionAPI);
		return handlers;
	}

	function readEvents(path: string): Array<Record<string, unknown>> {
		return readFileSync(path, "utf-8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as Record<string, unknown>);
	}

	test("writes real state and real telemetry for prompt lifecycle", async () => {
		const handlers = await registerExtension();

		expect(handlers.before_agent_start).toHaveLength(1);
		expect(handlers.before_provider_request).toHaveLength(1);
		expect(handlers.thinking_level_select).toHaveLength(1);

		await handlers.thinking_level_select[0]({
			level: "integration-thinking",
		});
		await handlers.before_agent_start[0]({ prompt: "please /go ahead" });

		expect(isPermissionGranted()).toBe(true);

		const eventsPath = join(
			tmpDir,
			"stats",
			"permission-enforcer",
			"events.jsonl",
		);
		const events = readEvents(eventsPath);
		const event = events[0];
		const details = event.details as Record<string, unknown>;

		expect(event.agent).toBe("pi");
		expect(event.namespace).toBe("permission-enforcer");
		expect(event.eventType).toBe("permission_state_change");
		expect(details.granted).toBe(true);
		expect(details.matchSource).toBe("slash");
		expect(details.promptLength).toBe("please /go ahead".length);
		expect(details.parentModel).toBe("unknown");
		expect(details.thinkingLevel).toBe("integration-thinking");
		expect(details.promptSnippet).toBeUndefined();
		expect(JSON.stringify(event)).not.toContain("please /go ahead");
	});
});
