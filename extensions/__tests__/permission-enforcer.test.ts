import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { isPermissionGranted } from "/Users/famillesendrison/.agents/agent-enforcers/permission-enforcer/src/core/state.ts";
import permissionEnforcerExt from "../permission-enforcer";

type ExtensionHandler = (
	event: Record<string, unknown>,
) => Promise<unknown> | unknown;
type HandlerRegistry = Record<string, ExtensionHandler[]>;

describe("permission-enforcer Pi extension", () => {
	let tmpDir: string;
	let originalTelemetryBaseDir: string | undefined;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "permission-enforcer-unit-"));
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

	function registerExtension(): HandlerRegistry {
		const handlers: HandlerRegistry = {};
		const piMock = {
			on: (event: string, cb: ExtensionHandler) => {
				handlers[event] = [...(handlers[event] ?? []), cb];
			},
		};

		permissionEnforcerExt(piMock as unknown as ExtensionAPI);
		return handlers;
	}

	function readPermissionEvents(): Array<Record<string, unknown>> {
		const eventsPath = join(
			tmpDir,
			"stats",
			"permission-enforcer",
			"events.jsonl",
		);
		return readFileSync(eventsPath, "utf-8")
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => JSON.parse(line) as Record<string, unknown>);
	}

	test("registers a before_agent_start handler", () => {
		const handlers = registerExtension();

		expect(handlers.before_agent_start).toHaveLength(1);
	});

	test("grants permission and logs slash /go prompts", async () => {
		const handlers = registerExtension();

		await handlers.before_agent_start[0]({ prompt: "please /go ahead" });

		expect(isPermissionGranted()).toBe(true);
		const event = readPermissionEvents()[0];
		const details = event.details as Record<string, unknown>;
		expect(event.eventType).toBe("permission_state_change");
		expect(details).toMatchObject({
			granted: true,
			parentModel: "unknown",
			matchSource: "slash",
			promptLength: "please /go ahead".length,
		});
	});

	test("grants permission and logs expanded skill prompts", async () => {
		const handlers = registerExtension();

		const prompt = '<skill name="go">implementation rules</skill>';
		await handlers.before_agent_start[0]({ prompt });

		expect(isPermissionGranted()).toBe(true);
		const details = readPermissionEvents()[0].details as Record<string, unknown>;
		expect(details).toMatchObject({
			granted: true,
			matchSource: "skill-tag",
			promptLength: prompt.length,
		});
	});

	test("revokes permission and logs prompts without /go", async () => {
		const handlers = registerExtension();

		await handlers.before_agent_start[0]({ prompt: "please /go ahead" });
		expect(isPermissionGranted()).toBe(true);

		await handlers.before_agent_start[0]({
			prompt: "continue without changing files",
		});

		expect(isPermissionGranted()).toBe(false);
		const events = readPermissionEvents();
		const details = events[1].details as Record<string, unknown>;
		expect(events).toHaveLength(2);
		expect(details).toMatchObject({
			granted: false,
			matchSource: "none",
			promptLength: "continue without changing files".length,
		});
	});
});
