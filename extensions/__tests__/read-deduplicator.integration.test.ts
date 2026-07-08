import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test";
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
		}),
	}),
);

import readDeduplicatorExt from "../read-deduplicator";

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

	test("full cycle: read -> block on re-read -> allow after truncation -> re-track", async () => {
		const file = join(tempDir, "doc.md");
		await writeFile(file, "Hello world, this is a unique text.");

		await trigger("session_start");
		await trigger("turn_start", { turnIndex: 1 });

		// 1. First read is allowed, no telemetry emitted yet (until tool_result)
		const blockResult1 = await trigger("tool_call", {
			toolName: "read",
			input: { path: file },
		});
		expect(blockResult1).toBeUndefined();
		expect(appendMock).not.toHaveBeenCalled();

		// 2. Capture read result (telemetry: action = read)
		await trigger("tool_result", {
			toolName: "read",
			input: { path: file },
			content: [{ type: "text", text: "Hello world, this is a unique text." }],
		});
		expect(appendMock).toHaveBeenCalledTimes(1);
		expect(appendMock.mock.calls[0][0]).toBe("file_access");
		expect(appendMock.mock.calls[0][1]).toMatchObject({
			action: "read",
			path: file,
			parentModel: "m-dedup",
			thinkingLevel: "high",
		});

		// 3. Next turn: content is still in provider context. Try to read again -> blocked
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

		const blockResult2 = await trigger("tool_call", {
			toolName: "read",
			input: { path: file },
		});
		expect(blockResult2).toEqual({
			block: true,
			reason: "(already in context, turn 1)",
		});

		// Telemetry should log block
		expect(appendMock).toHaveBeenCalledTimes(2);
		expect(appendMock.mock.calls[1][1]).toMatchObject({
			action: "blocked",
			path: file,
			parentModel: "m-dedup",
			thinkingLevel: "high",
			blockedReason: "already in context (turn 1)",
		});

		// 4. Next turn: content is truncated from provider context. Try to read -> allowed
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

		const blockResult3 = await trigger("tool_call", {
			toolName: "read",
			input: { path: file },
		});
		expect(blockResult3).toBeUndefined(); // Allowed!
	});

	test("re-read after file is modified is allowed", async () => {
		const file = join(tempDir, "doc.md");
		await writeFile(file, "Content V1");

		await trigger("session_start");
		await trigger("turn_start", { turnIndex: 1 });

		// Read V1
		await trigger("tool_result", {
			toolName: "read",
			input: { path: file },
			content: [{ type: "text", text: "Content V1" }],
		});
		expect(appendMock).toHaveBeenCalledTimes(1);

		// Edit file on disk (changes fingerprint)
		await trigger("turn_start", { turnIndex: 2 });
		await trigger("before_provider_request", {
			payload: {
				messages: [{ content: [{ type: "text", text: "Content V1" }] }],
			},
		});

		await writeFile(file, "Content V2");

		// Even though "Content V1" is still in the payload, since fingerprint changed on disk, re-read is allowed!
		const blockResult = await trigger("tool_call", {
			toolName: "read",
			input: { path: file },
		});
		expect(blockResult).toBeUndefined();
	});
});

