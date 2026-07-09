import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";

const appendMock = mock();
mock.module(
	"/Users/famillesendrison/Developper/Projects/telemetry-tools/event-sink/src/index.ts",
	() => ({
		createEventSink: (opts: any) => {
			// Store options so tests can inspect them
			(appendMock as any)._sinkOpts = opts;
			return { append: appendMock, filePath: "/fake/events.jsonl" };
		},
	}),
);

// @ts-ignore: ?real is a Bun feature to bypass module mocks, which TS doesn't recognize
import { createPiTelemetry } from "../shared/pi-telemetry?real";

afterAll(() => {
	mock.restore();
});

describe("createPiTelemetry", () => {
	let originalTelemetryBaseDir: string | undefined;

	beforeEach(() => {
		appendMock.mockClear();
		originalTelemetryBaseDir = process.env.PI_TELEMETRY_BASE_DIR;
		delete process.env.PI_TELEMETRY_BASE_DIR;
	});

	afterEach(() => {
		if (originalTelemetryBaseDir === undefined) {
			delete process.env.PI_TELEMETRY_BASE_DIR;
		} else {
			process.env.PI_TELEMETRY_BASE_DIR = originalTelemetryBaseDir;
		}
	});

	test("registers before_provider_request and thinking_level_select hooks", () => {
		const handlers: Record<string, Function> = {};
		const piMock = {
			on: (event: string, cb: Function) => {
				handlers[event] = cb;
			},
		};

		createPiTelemetry(piMock as any, "test-ext");

		expect(handlers["before_provider_request"]).toBeDefined();
		expect(handlers["thinking_level_select"]).toBeDefined();
	});

	test("model and thinking default to 'unknown' before any hook fires", () => {
		const piMock = { on: () => {} };
		const telemetry = createPiTelemetry(piMock as any, "test-ext");

		expect(telemetry.model).toBe("unknown");
		// thinking defaults to whatever settings.json returns (or "unknown")
		expect(typeof telemetry.thinking).toBe("string");
	});

	test("model updates after before_provider_request fires", async () => {
		const handlers: Record<string, Function> = {};
		const piMock = {
			on: (event: string, cb: Function) => {
				handlers[event] = cb;
			},
		};

		const telemetry = createPiTelemetry(piMock as any, "test-ext");
		expect(telemetry.model).toBe("unknown");

		await handlers["before_provider_request"]({
			payload: { model: "claude-4-opus" },
		});
		expect(telemetry.model).toBe("claude-4-opus");
	});

	test("thinking updates after thinking_level_select fires", async () => {
		const handlers: Record<string, Function> = {};
		const piMock = {
			on: (event: string, cb: Function) => {
				handlers[event] = cb;
			},
		};

		const telemetry = createPiTelemetry(piMock as any, "test-ext");

		await handlers["thinking_level_select"]({ level: "xhigh" });
		expect(telemetry.thinking).toBe("xhigh");
	});

	test("sessionId is a valid UUID", () => {
		const piMock = { on: () => {} };
		const telemetry = createPiTelemetry(piMock as any, "test-ext");

		expect(telemetry.sessionId).toMatch(
			/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
		);
	});

	test("sink is created with correct namespace and agent", () => {
		const piMock = { on: () => {} };
		createPiTelemetry(piMock as any, "my-namespace");

		expect((appendMock as any)._sinkOpts.namespace).toBe("my-namespace");
		expect((appendMock as any)._sinkOpts.agent).toBe("pi");
	});

	test("statsDir override is respected", () => {
		const piMock = { on: () => {} };
		createPiTelemetry(piMock as any, "test-ext", {
			statsDir: "/custom/path",
		});

		expect((appendMock as any)._sinkOpts.statsDir).toBe("/custom/path");
	});

	test("PI_TELEMETRY_BASE_DIR override is respected", () => {
		process.env.PI_TELEMETRY_BASE_DIR = "/tmp/pi-telemetry-test";
		const piMock = { on: () => {} };
		createPiTelemetry(piMock as any, "test-ext");

		expect((appendMock as any)._sinkOpts.statsDir).toBe(
			"/tmp/pi-telemetry-test/test-ext",
		);
	});

	test("sink.append works through the telemetry object", () => {
		const piMock = { on: () => {} };
		const telemetry = createPiTelemetry(piMock as any, "test-ext");

		telemetry.sink.append("test_event", { foo: "bar" });
		expect(appendMock).toHaveBeenCalledTimes(1);
		expect(appendMock.mock.calls[0][0]).toBe("test_event");
		expect(appendMock.mock.calls[0][1]).toEqual({ foo: "bar" });
	});

	test("ignores non-string model payloads", async () => {
		const handlers: Record<string, Function> = {};
		const piMock = {
			on: (event: string, cb: Function) => {
				handlers[event] = cb;
			},
		};

		const telemetry = createPiTelemetry(piMock as any, "test-ext");

		await handlers["before_provider_request"]({ payload: { model: 42 } });
		expect(telemetry.model).toBe("unknown");

		await handlers["before_provider_request"]({ payload: {} });
		expect(telemetry.model).toBe("unknown");
	});
});
