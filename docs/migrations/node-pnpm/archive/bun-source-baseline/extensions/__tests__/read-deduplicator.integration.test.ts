import {
	afterAll,
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	test,
} from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

const appendMock = mock();
mock.module(
	"/Users/famillesendrison/.pi/agent/extensions/shared/pi-telemetry.ts",
	() => ({
		createPiTelemetry: () => ({
			sink: { append: appendMock },
			model: "m-dedup",
			thinking: "high",
			sessionId: "s-uuid-dedup",
			contextDetails: () => ({
				parentModel: "m-dedup",
				thinkingLevel: "high",
			}),
			append: (
				eventType: string,
				details: Record<string, unknown>,
				overrides?: Record<string, unknown>,
			) =>
				appendMock(
					eventType,
					{
						...details,
						parentModel: "m-dedup",
						thinkingLevel: "high",
					},
					overrides,
				),
		}),
	}),
);

import readDeduplicatorExt from "../read-deduplicator";

afterAll(() => {
	mock.restore();
});

describe("read-deduplicator extension integration", () => {
	let tempDir: string;
	const handlers: Record<string, Function[]> = {};

	const piMock = {
		on: (event: string, cb: Function) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(cb);
		},
	};

	readDeduplicatorExt(piMock as any);

	beforeEach(async () => {
		appendMock.mockClear();
		tempDir = await mkdtemp(join(tmpdir(), "pi-dedup-"));
	});

	afterEach(async () => {
		await rm(tempDir, { recursive: true, force: true });
	});

	const trigger = async (event: string, ...args: any[]) => {
		const list = handlers[event] || [];
		let lastResult: any;
		for (const h of list) {
			lastResult = await h(...args);
		}
		return lastResult;
	};

	test("full cycle: read -> cache serve same range -> miss on different range", async () => {
		const file = join(tempDir, "doc.md");
		await writeFile(file, "Hello world, this is a unique text.");

		await trigger("session_start");
		await trigger("turn_start", { turnIndex: 1 });

		// 1. First read is allowed, no telemetry emitted yet (until tool_result)
		const toolCallResult1 = await trigger("tool_call", {
			toolName: "read",
			toolCallId: "read-1",
			input: { path: file, offset: 1, limit: 10 },
		});
		expect(toolCallResult1).toBeUndefined();
		expect(appendMock).not.toHaveBeenCalled();

		// 2. Capture read result (telemetry: action = read)
		await trigger("tool_result", {
			toolName: "read",
			toolCallId: "read-1",
			input: { path: file, offset: 1, limit: 10 },
			content: [{ type: "text", text: "Hello world, this is a unique text." }],
			details: { lines: 1 },
			isError: false,
		});
		expect(appendMock).toHaveBeenCalledTimes(1);
		expect(appendMock.mock.calls[0][0]).toBe("file_access");
		expect(appendMock.mock.calls[0][1]).toMatchObject({
			action: "read",
			path: file,
			parentModel: "m-dedup",
			thinkingLevel: "high",
		});

		// 3. Next turn: same fingerprint and range. The read is allowed, then result is swapped.
		await trigger("turn_start", { turnIndex: 2 });
		await trigger("before_provider_request", {
			payload: {
				messages: [
					{
						content: [
							{ type: "text", text: "Here is the file: Hello world, this is a unique text." },
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
		expect(toolCallResult2).toBeUndefined();
		const cachedResult = await trigger("tool_result", {
			toolName: "read",
			toolCallId: "read-2",
			input: { path: file, offset: 1, limit: 10 },
			content: [{ type: "text", text: "fresh disk text should be replaced" }],
			details: { lines: 1 },
			isError: false,
		});
		expect(cachedResult).toEqual({
			content: [{ type: "text", text: "Hello world, this is a unique text." }],
			details: { lines: 1 },
			isError: false,
		});

		// Telemetry should log cache serve
		expect(appendMock).toHaveBeenCalledTimes(2);
		expect(appendMock.mock.calls[1][1]).toMatchObject({
			action: "cache_served",
			path: file,
			parentModel: "m-dedup",
			thinkingLevel: "high",
		});
		expect(appendMock.mock.calls[1][1].blockedReason).toBeUndefined();

		// 4. Different offset/limit is a cache miss and re-tracks the latest read.
		await trigger("turn_start", { turnIndex: 3 });
		await trigger("before_provider_request", {
			payload: {
				messages: [
					{
						content: [
							{ type: "text", text: "completely unrelated query" },
						],
					},
				],
			},
		});

		const toolCallResult3 = await trigger("tool_call", {
			toolName: "read",
			toolCallId: "read-3",
			input: { path: file, offset: 2, limit: 1 },
		});
		expect(toolCallResult3).toBeUndefined();
		const missResult = await trigger("tool_result", {
			toolName: "read",
			toolCallId: "read-3",
			input: { path: file, offset: 2, limit: 1 },
			content: [{ type: "text", text: "second line" }],
			details: { lines: 1 },
			isError: false,
		});
		expect(missResult).toBeUndefined();
		expect(appendMock).toHaveBeenCalledTimes(3);
		expect(appendMock.mock.calls[2][1]).toMatchObject({
			action: "read",
			path: file,
		});
	});

	test("re-read after file is modified re-tracks before later cache serving", async () => {
		const file = join(tempDir, "doc.md");
		await writeFile(file, "Content V1");

		await trigger("session_start");
		await trigger("turn_start", { turnIndex: 1 });

		// Read V1
		await trigger("tool_result", {
			toolName: "read",
			toolCallId: "modified-1",
			input: { path: file },
			content: [{ type: "text", text: "Content V1" }],
			details: { lines: 1 },
			isError: false,
		});
		expect(appendMock).toHaveBeenCalledTimes(1);

		// Edit file on disk (changes fingerprint)
		await trigger("turn_start", { turnIndex: 2 });
		await trigger("before_provider_request", {
			payload: {
				messages: [{ content: [{ type: "text", text: "Content V1" }] }],
			},
		});

		await writeFile(file, "Content V2 has changed");

		// Even though "Content V1" is still in the payload, since fingerprint changed on disk, re-read is allowed!
		const toolCallResult = await trigger("tool_call", {
			toolName: "read",
			toolCallId: "modified-2",
			input: { path: file },
		});
		expect(toolCallResult).toBeUndefined();
		await trigger("tool_result", {
			toolName: "read",
			toolCallId: "modified-2",
			input: { path: file },
			content: [{ type: "text", text: "Content V2 has changed" }],
			details: { lines: 1 },
			isError: false,
		});
		expect(appendMock).toHaveBeenCalledTimes(2);
		expect(appendMock.mock.calls[1][1]).toMatchObject({
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

		expect(cachedResult).toEqual({
			content: [{ type: "text", text: "Content V2 has changed" }],
			details: { lines: 1 },
			isError: false,
		});
		expect(appendMock.mock.calls[2][1]).toMatchObject({
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

		expect(result).toBeUndefined();
		expect(appendMock.mock.calls[1][1]).toMatchObject({
			action: "read",
			path: file,
		});
	});
});
