import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, afterEach, beforeEach, describe, test } from "node:test";
import { importPiExtension } from "./pi-extension-loader.node.ts";

type ExtensionHandler = (...args: unknown[]) => Promise<unknown> | unknown;

type ExtensionFactory = (pi: {
	on: (event: string, handler: ExtensionHandler) => void;
}) => void;

interface TelemetryEvent {
	eventType: string;
	details: Record<string, unknown>;
}

const telemetryRoot = await mkdtemp(join(tmpdir(), "pi-dedup-node-telemetry-"));
const eventsPath = join(telemetryRoot, "read-deduplicator", "events.jsonl");
const originalTelemetryBaseDir = process.env.PI_TELEMETRY_BASE_DIR;
process.env.PI_TELEMETRY_BASE_DIR = telemetryRoot;

const handlers: Record<string, ExtensionHandler[]> = {};
const piMock = {
	on: (event: string, handler: ExtensionHandler) => {
		handlers[event] = [...(handlers[event] ?? []), handler];
	},
};

const readDeduplicatorExt = await importPiExtension<ExtensionFactory>(
	"read-deduplicator.ts",
);
readDeduplicatorExt(piMock);

async function trigger(event: string, ...args: unknown[]): Promise<unknown> {
	let lastResult: unknown;
	for (const handler of handlers[event] ?? []) {
		lastResult = await handler(...args);
	}
	return lastResult;
}

await trigger("before_provider_request", {
	payload: { model: "m-dedup", messages: [] },
});
await trigger("thinking_level_select", { level: "high" });

after(async () => {
	if (originalTelemetryBaseDir === undefined) {
		delete process.env.PI_TELEMETRY_BASE_DIR;
	} else {
		process.env.PI_TELEMETRY_BASE_DIR = originalTelemetryBaseDir;
	}
	await rm(telemetryRoot, { recursive: true, force: true });
});

function readEvents(): TelemetryEvent[] {
	if (!existsSync(eventsPath)) return [];
	return readFileSync(eventsPath, "utf-8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as TelemetryEvent);
}

describe("read-deduplicator extension integration", () => {
	let tempDir: string;

	beforeEach(async () => {
		await rm(eventsPath, { force: true });
		tempDir = await mkdtemp(join(tmpdir(), "pi-dedup-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	test("full cycle: read -> cache serve same range -> miss on different range", async () => {
		const file = join(tempDir, "doc.md");
		await writeFile(file, "Hello world, this is a unique text.");

		await trigger("session_start");
		await trigger("turn_start", { turnIndex: 1 });

		const toolCallResult1 = await trigger("tool_call", {
			toolName: "read",
			toolCallId: "read-1",
			input: { path: file, offset: 1, limit: 10 },
		});
		assert.strictEqual(toolCallResult1, undefined);
		assert.strictEqual(readEvents().length, 0);

		await trigger("tool_result", {
			toolName: "read",
			toolCallId: "read-1",
			input: { path: file, offset: 1, limit: 10 },
			content: [{ type: "text", text: "Hello world, this is a unique text." }],
			details: { lines: 1 },
			isError: false,
		});
		let events = readEvents();
		assert.strictEqual(events.length, 1);
		assert.strictEqual(events[0].eventType, "file_access");
		assert.partialDeepStrictEqual(events[0].details, {
			action: "read",
			path: file,
			parentModel: "m-dedup",
			thinkingLevel: "high",
		});

		await trigger("turn_start", { turnIndex: 2 });
		await trigger("before_provider_request", {
			payload: {
				messages: [
					{
						content: [
							{
								type: "text",
								text: "Here is the file: Hello world, this is a unique text.",
							},
						],
					},
				],
			},
		});

		const toolCallResult2 = await trigger("tool_call", {
			toolName: "read",
			toolCallId: "read-2",
			input: { path: file, offset: 1, limit: 10 },
		});
		assert.strictEqual(toolCallResult2, undefined);
		const cachedResult = await trigger("tool_result", {
			toolName: "read",
			toolCallId: "read-2",
			input: { path: file, offset: 1, limit: 10 },
			content: [{ type: "text", text: "fresh disk text should be replaced" }],
			details: { lines: 1 },
			isError: false,
		});
		assert.deepStrictEqual(cachedResult, {
			content: [{ type: "text", text: "Hello world, this is a unique text." }],
			details: { lines: 1 },
			isError: false,
		});

		events = readEvents();
		assert.strictEqual(events.length, 2);
		assert.partialDeepStrictEqual(events[1].details, {
			action: "cache_served",
			path: file,
			parentModel: "m-dedup",
			thinkingLevel: "high",
		});
		assert.strictEqual(events[1].details.blockedReason, undefined);

		await trigger("turn_start", { turnIndex: 3 });
		await trigger("before_provider_request", {
			payload: {
				messages: [
					{
						content: [{ type: "text", text: "completely unrelated query" }],
					},
				],
			},
		});

		const toolCallResult3 = await trigger("tool_call", {
			toolName: "read",
			toolCallId: "read-3",
			input: { path: file, offset: 2, limit: 1 },
		});
		assert.strictEqual(toolCallResult3, undefined);
		const missResult = await trigger("tool_result", {
			toolName: "read",
			toolCallId: "read-3",
			input: { path: file, offset: 2, limit: 1 },
			content: [{ type: "text", text: "second line" }],
			details: { lines: 1 },
			isError: false,
		});
		assert.strictEqual(missResult, undefined);
		events = readEvents();
		assert.strictEqual(events.length, 3);
		assert.partialDeepStrictEqual(events[2].details, {
			action: "read",
			path: file,
		});
	});

	test("re-read after file is modified re-tracks before later cache serving", async () => {
		const file = join(tempDir, "doc.md");
		await writeFile(file, "Content V1");

		await trigger("session_start");
		await trigger("turn_start", { turnIndex: 1 });

		await trigger("tool_result", {
			toolName: "read",
			toolCallId: "modified-1",
			input: { path: file },
			content: [{ type: "text", text: "Content V1" }],
			details: { lines: 1 },
			isError: false,
		});
		assert.strictEqual(readEvents().length, 1);

		await trigger("turn_start", { turnIndex: 2 });
		await trigger("before_provider_request", {
			payload: {
				messages: [{ content: [{ type: "text", text: "Content V1" }] }],
			},
		});

		await writeFile(file, "Content V2 has changed");

		const toolCallResult = await trigger("tool_call", {
			toolName: "read",
			toolCallId: "modified-2",
			input: { path: file },
		});
		assert.strictEqual(toolCallResult, undefined);
		await trigger("tool_result", {
			toolName: "read",
			toolCallId: "modified-2",
			input: { path: file },
			content: [{ type: "text", text: "Content V2 has changed" }],
			details: { lines: 1 },
			isError: false,
		});
		let events = readEvents();
		assert.strictEqual(events.length, 2);
		assert.partialDeepStrictEqual(events[1].details, {
			action: "read",
			path: file,
		});

		await trigger("turn_start", { turnIndex: 3 });
		await trigger("tool_call", {
			toolName: "read",
			toolCallId: "modified-3",
			input: { path: file },
		});
		const cachedResult = await trigger("tool_result", {
			toolName: "read",
			toolCallId: "modified-3",
			input: { path: file },
			content: [{ type: "text", text: "disk text should be replaced" }],
			details: { lines: 1 },
			isError: false,
		});

		assert.deepStrictEqual(cachedResult, {
			content: [{ type: "text", text: "Content V2 has changed" }],
			details: { lines: 1 },
			isError: false,
		});
		events = readEvents();
		assert.partialDeepStrictEqual(events[2].details, {
			action: "cache_served",
			path: file,
		});
	});

	test("pending cache serve falls through if the file changes before tool_result", async () => {
		const file = join(tempDir, "doc.md");
		await writeFile(file, "Content V1");

		await trigger("session_start");
		await trigger("turn_start", { turnIndex: 1 });
		await trigger("tool_result", {
			toolName: "read",
			toolCallId: "race-1",
			input: { path: file },
			content: [{ type: "text", text: "Content V1" }],
			details: { lines: 1 },
			isError: false,
		});

		await trigger("turn_start", { turnIndex: 2 });
		await trigger("tool_call", {
			toolName: "read",
			toolCallId: "race-2",
			input: { path: file },
		});
		await writeFile(file, "Content V2 changed after preflight");

		const result = await trigger("tool_result", {
			toolName: "read",
			toolCallId: "race-2",
			input: { path: file },
			content: [{ type: "text", text: "Content V2 changed after preflight" }],
			details: { lines: 1 },
			isError: false,
		});

		assert.strictEqual(result, undefined);
		const events = readEvents();
		assert.partialDeepStrictEqual(events[1].details, {
			action: "read",
			path: file,
		});
	});
});
