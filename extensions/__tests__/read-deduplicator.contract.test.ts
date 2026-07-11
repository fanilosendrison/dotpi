/**
 * Contract tests for read-deduplicator events (via event-sink).
 *
 * Tests the DATA CONTRACT only:
 *   - namespace, eventType, details shape
 *   - cache_served action without blockedReason
 *   - read action without blockedReason
 *
 * Infrastructure (file creation, mkdir, ordering, required fields schema)
 * is covered by event-sink's own tests.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventSink } from "/Users/famillesendrison/Developper/Projects/telemetry-tools/event-sink/src/index.ts";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "rd-contract-"));
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

// ── file_access (cache_served) ────────────────────────────────────────────

describe("file_access (cache_served)", () => {
	test("writes file_access with all fields for cache_served action", () => {
		const sink = createEventSink({
			statsDir: tmpDir,
			agent: "pi",
			namespace: "read-deduplicator",
		});

		sink.append(
			"file_access",
			{
				action: "cache_served",
				path: "/a.ts",
				sizeBytes: 100,
				turnIndex: 1,
				parentModel: "deepseek-v4-flash",
				thinkingLevel: "xhigh",
			},
			{
				timestamp: "2026-07-03T12:00:00Z",
				sessionId: "sess-1",
				workspace: "/w",
			},
		);

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.eventType).toBe("file_access");
		expect(ev.namespace).toBe("read-deduplicator");
		expect(ev.agent).toBe("pi");
		expect(ev.workspace).toBe("/w");
		expect(ev.sessionId).toBe("sess-1");
		expect(ev.timestamp).toBe("2026-07-03T12:00:00Z");
		expect(ev.eventId).toBeDefined();
		expect(ev.details.action).toBe("cache_served");
		expect(ev.details.path).toBe("/a.ts");
		expect(ev.details.sizeBytes).toBe(100);
		expect(ev.details.turnIndex).toBe(1);
		expect(ev.details.parentModel).toBe("deepseek-v4-flash");
		expect(ev.details.thinkingLevel).toBe("xhigh");
		expect(ev.details.blockedReason).toBeUndefined();
	});
});

// ── file_access (read) ───────────────────────────────────────────────────

describe("file_access (read)", () => {
	test("writes file_access with all fields for read action, no blockedReason", () => {
		const sink = createEventSink({
			statsDir: tmpDir,
			agent: "pi",
			namespace: "read-deduplicator",
		});

		sink.append(
			"file_access",
			{
				action: "read",
				path: "/a.ts",
				sizeBytes: 100,
				turnIndex: 1,
				parentModel: "deepseek-v4-flash",
				thinkingLevel: "xhigh",
			},
			{
				timestamp: "2026-07-03T12:00:00Z",
				sessionId: "sess-1",
				workspace: "/w",
			},
		);

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.eventType).toBe("file_access");
		expect(ev.namespace).toBe("read-deduplicator");
		expect(ev.agent).toBe("pi");
		expect(ev.workspace).toBe("/w");
		expect(ev.sessionId).toBe("sess-1");
		expect(ev.timestamp).toBe("2026-07-03T12:00:00Z");
		expect(ev.eventId).toBeDefined();
		expect(ev.details.action).toBe("read");
		expect(ev.details.path).toBe("/a.ts");
		expect(ev.details.sizeBytes).toBe(100);
		expect(ev.details.turnIndex).toBe(1);
		expect(ev.details.parentModel).toBe("deepseek-v4-flash");
		expect(ev.details.thinkingLevel).toBe("xhigh");
		expect(ev.details.blockedReason).toBeUndefined();
	});
});

// ── Schema compliance (contract-specific) ────────────────────────────────

describe("schema compliance", () => {
	test("no cycleId field present", () => {
		const sink = createEventSink({
			statsDir: tmpDir,
			agent: "pi",
			namespace: "read-deduplicator",
		});

		sink.append(
			"file_access",
			{
				action: "read",
				path: "/a.ts",
				sizeBytes: 100,
				turnIndex: 1,
				parentModel: "m1",
				thinkingLevel: "xhigh",
			},
			{
				timestamp: "t1",
				sessionId: "s1",
				workspace: "/w",
			},
		);

		expect(readEvents(join(tmpDir, "events.jsonl"))[0].cycleId).toBeUndefined();
	});
});
