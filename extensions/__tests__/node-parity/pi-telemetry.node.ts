import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createPiTelemetry } from "../../shared/pi-telemetry.ts";

type HookHandler = (
	event: Record<string, unknown>,
) => Promise<unknown> | unknown;

interface TelemetryEvent {
	timestamp: string;
	agent: string;
	namespace: string;
	eventType: string;
	details: Record<string, unknown>;
}

function asExtensionApi(pi: {
	on(event: string, handler: HookHandler): void;
}): ExtensionAPI {
	return pi as unknown as ExtensionAPI;
}

function readEvents(filePath: string): TelemetryEvent[] {
	return readFileSync(filePath, "utf-8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as TelemetryEvent);
}

describe("createPiTelemetry", () => {
	let tmpDir: string;
	let originalTelemetryBaseDir: string | undefined;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "pi-telemetry-unit-"));
		originalTelemetryBaseDir = process.env.PI_TELEMETRY_BASE_DIR;
		process.env.PI_TELEMETRY_BASE_DIR = tmpDir;
	});

	afterEach(() => {
		if (originalTelemetryBaseDir === undefined) {
			delete process.env.PI_TELEMETRY_BASE_DIR;
		} else {
			process.env.PI_TELEMETRY_BASE_DIR = originalTelemetryBaseDir;
		}
		rmSync(tmpDir, { recursive: true, force: true });
	});

	test("registers before_provider_request and thinking_level_select hooks", () => {
		const handlers: Record<string, HookHandler> = {};
		const piMock = asExtensionApi({
			on: (event, handler) => {
				handlers[event] = handler;
			},
		});

		createPiTelemetry(piMock, "test-ext");

		assert.notStrictEqual(handlers.before_provider_request, undefined);
		assert.notStrictEqual(handlers.thinking_level_select, undefined);
	});

	test("model and thinking default to 'unknown' before any hook fires", () => {
		const piMock = asExtensionApi({ on: () => {} });
		const telemetry = createPiTelemetry(piMock, "test-ext");

		assert.strictEqual(telemetry.model, "unknown");
		assert.strictEqual(typeof telemetry.thinking, "string");
	});

	test("model updates after before_provider_request fires", async () => {
		const handlers: Record<string, HookHandler> = {};
		const piMock = asExtensionApi({
			on: (event, handler) => {
				handlers[event] = handler;
			},
		});

		const telemetry = createPiTelemetry(piMock, "test-ext");
		assert.strictEqual(telemetry.model, "unknown");

		await handlers.before_provider_request({
			payload: { model: "claude-4-opus" },
		});
		assert.strictEqual(telemetry.model, "claude-4-opus");
	});

	test("thinking updates after thinking_level_select fires", async () => {
		const handlers: Record<string, HookHandler> = {};
		const piMock = asExtensionApi({
			on: (event, handler) => {
				handlers[event] = handler;
			},
		});

		const telemetry = createPiTelemetry(piMock, "test-ext");

		await handlers.thinking_level_select({ level: "xhigh" });
		assert.strictEqual(telemetry.thinking, "xhigh");
	});

	test("sessionId is a valid UUID", () => {
		const piMock = asExtensionApi({ on: () => {} });
		const telemetry = createPiTelemetry(piMock, "test-ext");

		assert.match(
			telemetry.sessionId,
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
		);
	});

	test("sink is created with correct namespace and agent", () => {
		const piMock = asExtensionApi({ on: () => {} });
		const telemetry = createPiTelemetry(piMock, "my-namespace");
		telemetry.sink.append("sink_options_probe", {});
		const event = readEvents(telemetry.sink.filePath)[0];

		assert.strictEqual(event.namespace, "my-namespace");
		assert.strictEqual(event.agent, "pi");
	});

	test("statsDir override is respected", () => {
		const piMock = asExtensionApi({ on: () => {} });
		const statsDir = join(tmpDir, "custom", "path");
		const telemetry = createPiTelemetry(piMock, "test-ext", { statsDir });

		assert.strictEqual(telemetry.sink.filePath, join(statsDir, "events.jsonl"));
	});

	test("PI_TELEMETRY_BASE_DIR override is respected", () => {
		const telemetryBaseDir = join(tmpDir, "pi-telemetry-test");
		process.env.PI_TELEMETRY_BASE_DIR = telemetryBaseDir;
		const piMock = asExtensionApi({ on: () => {} });
		const telemetry = createPiTelemetry(piMock, "test-ext");

		assert.strictEqual(
			telemetry.sink.filePath,
			join(telemetryBaseDir, "test-ext", "events.jsonl"),
		);
	});

	test("sink.append works through the telemetry object", () => {
		const piMock = asExtensionApi({ on: () => {} });
		const telemetry = createPiTelemetry(piMock, "test-ext");

		telemetry.sink.append("test_event", { foo: "bar" });
		const events = readEvents(telemetry.sink.filePath);
		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0].eventType, "test_event");
		assert.deepStrictEqual(events[0].details, { foo: "bar" });
	});

	test("append adds current model and thinking details", async () => {
		const handlers: Record<string, HookHandler> = {};
		const piMock = asExtensionApi({
			on: (event, handler) => {
				handlers[event] = handler;
			},
		});
		const telemetry = createPiTelemetry(piMock, "test-ext");

		await handlers.before_provider_request({
			payload: { model: "claude-sonnet-4" },
		});
		await handlers.thinking_level_select({ level: "high" });

		telemetry.append("test_event", { foo: "bar" });
		const events = readEvents(telemetry.sink.filePath);
		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0].eventType, "test_event");
		assert.deepStrictEqual(events[0].details, {
			foo: "bar",
			parentModel: "claude-sonnet-4",
			thinkingLevel: "high",
		});
		assert.match(events[0].timestamp, /^\d{4}-\d{2}-\d{2}T/);
	});

	test("ignores non-string model payloads", async () => {
		const handlers: Record<string, HookHandler> = {};
		const piMock = asExtensionApi({
			on: (event, handler) => {
				handlers[event] = handler;
			},
		});

		const telemetry = createPiTelemetry(piMock, "test-ext");

		await handlers.before_provider_request({ payload: { model: 42 } });
		assert.strictEqual(telemetry.model, "unknown");

		await handlers.before_provider_request({ payload: {} });
		assert.strictEqual(telemetry.model, "unknown");
	});
});
