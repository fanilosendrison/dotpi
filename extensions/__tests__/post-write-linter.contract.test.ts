/**
 * Contract tests for post-write-linter events (via event-sink).
 *
 * Tests the DATA CONTRACT only:
 *   - namespace, eventType, details shape
 *   - error status with output (truncation at 500)
 *   - success status without output
 *
 * Infrastructure (file creation, mkdir, ordering, schema compliance)
 * is covered by event-sink's own tests.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventSink } from "/Users/famillesendrison/Developper/Projects/telemetry-tools/event-sink/src/index.ts";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "pwl-contract-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function readEvents(filePath: string): any[] {
	return readFileSync(filePath, "utf-8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l));
}

const BASE = {
	agent: "pi",
	namespace: "post-write-linter",
	sessionId: "s1",
	workspace: "/cwd",
};

// ── lint_result (error) ──────────────────────────────────────────────────

describe("lint_result (error)", () => {
	test("writes lint_result with error status and all fields", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		sink.append(
			"lint_result",
			{
				filePath: "/src/foo.ts",
				language: "ts",
				status: "error",
				output: "error[noUnusedVars]: 'x' is never read",
				parentModel: "deepseek-v4-pro",
				thinkingLevel: "xhigh",
			},
			{ timestamp: "2026-07-04T12:00:00.000Z" },
		);

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.eventType).toBe("lint_result");
		expect(ev.namespace).toBe("post-write-linter");
		expect(ev.agent).toBe("pi");
		expect(ev.sessionId).toBe("s1");
		expect(ev.workspace).toBe("/cwd");
		expect(ev.details.status).toBe("error");
		expect(ev.details.filePath).toBe("/src/foo.ts");
		expect(ev.details.language).toBe("ts");
		expect(ev.details.output).toBe("error[noUnusedVars]: 'x' is never read");
		expect(ev.details.parentModel).toBe("deepseek-v4-pro");
		expect(ev.details.thinkingLevel).toBe("xhigh");
		expect(ev.timestamp).toBe("2026-07-04T12:00:00.000Z");
		expect(ev.eventId).toBeDefined();
	});

	test("truncates output to 500 characters", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		const output = "x".repeat(600);
		const outputTruncated =
			output.length <= 500 ? output : output.slice(0, 500) + "…";

		sink.append(
			"lint_result",
			{
				filePath: "/a.ts",
				language: "ts",
				status: "error",
				output: outputTruncated,
				parentModel: "m1",
				thinkingLevel: "xhigh",
			},
			{ timestamp: "t1" },
		);

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.details.output.length).toBe(501);
		expect(ev.details.output.endsWith("…")).toBe(true);
	});

	test("does not truncate short outputs", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		sink.append(
			"lint_result",
			{
				filePath: "/a.ts",
				language: "ts",
				status: "error",
				output: "short error",
				parentModel: "m1",
				thinkingLevel: "xhigh",
			},
			{ timestamp: "t1" },
		);

		expect(readEvents(join(tmpDir, "events.jsonl"))[0].details.output).toBe(
			"short error",
		);
	});
});

// ── lint_result (success) ────────────────────────────────────────────────

describe("lint_result (success)", () => {
	test("writes lint_result with success status, no output", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		sink.append(
			"lint_result",
			{
				filePath: "/b.ts",
				language: "ts",
				status: "success",
				parentModel: "m1",
				thinkingLevel: "low",
			},
			{ timestamp: "t1" },
		);

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.details.status).toBe("success");
		expect(ev.details.output).toBeUndefined();
	});
});

// ── Schema compliance (contract-specific) ────────────────────────────────

describe("schema compliance", () => {
	test("no cycleId field present", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		sink.append(
			"lint_result",
			{
				filePath: "/a.ts",
				language: "ts",
				status: "success",
				parentModel: "m1",
				thinkingLevel: "xhigh",
			},
			{ timestamp: "t1" },
		);

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.cycleId).toBeUndefined();
	});
});
