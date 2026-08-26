/**
 * Node parity target for read-deduplicator telemetry contracts.
 *
 * The historical Bun source remains at
 * extensions/__tests__/read-deduplicator.contract.test.ts.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { createEventSink } from "@fanilosendrison/event-sink";

interface FileAccessEvent {
	readonly eventType: string;
	readonly namespace: string;
	readonly agent: string;
	readonly workspace: string;
	readonly sessionId: string;
	readonly timestamp: string;
	readonly eventId: string;
	readonly cycleId?: unknown;
	readonly details: Readonly<Record<string, unknown>>;
}

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "rd-contract-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function readEvents(filePath: string): readonly FileAccessEvent[] {
	return readFileSync(filePath, "utf-8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as FileAccessEvent);
}

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

		const event = readEvents(join(tmpDir, "events.jsonl"))[0];
		assert.ok(event);
		assert.strictEqual(event.eventType, "file_access");
		assert.strictEqual(event.namespace, "read-deduplicator");
		assert.strictEqual(event.agent, "pi");
		assert.strictEqual(event.workspace, "/w");
		assert.strictEqual(event.sessionId, "sess-1");
		assert.strictEqual(event.timestamp, "2026-07-03T12:00:00Z");
		assert.notStrictEqual(event.eventId, undefined);
		assert.strictEqual(event.details.action, "cache_served");
		assert.strictEqual(event.details.path, "/a.ts");
		assert.strictEqual(event.details.sizeBytes, 100);
		assert.strictEqual(event.details.turnIndex, 1);
		assert.strictEqual(event.details.parentModel, "deepseek-v4-flash");
		assert.strictEqual(event.details.thinkingLevel, "xhigh");
		assert.strictEqual(event.details.blockedReason, undefined);
	});
});

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

		const event = readEvents(join(tmpDir, "events.jsonl"))[0];
		assert.ok(event);
		assert.strictEqual(event.eventType, "file_access");
		assert.strictEqual(event.namespace, "read-deduplicator");
		assert.strictEqual(event.agent, "pi");
		assert.strictEqual(event.workspace, "/w");
		assert.strictEqual(event.sessionId, "sess-1");
		assert.strictEqual(event.timestamp, "2026-07-03T12:00:00Z");
		assert.notStrictEqual(event.eventId, undefined);
		assert.strictEqual(event.details.action, "read");
		assert.strictEqual(event.details.path, "/a.ts");
		assert.strictEqual(event.details.sizeBytes, 100);
		assert.strictEqual(event.details.turnIndex, 1);
		assert.strictEqual(event.details.parentModel, "deepseek-v4-flash");
		assert.strictEqual(event.details.thinkingLevel, "xhigh");
		assert.strictEqual(event.details.blockedReason, undefined);
	});
});

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

		const event = readEvents(join(tmpDir, "events.jsonl"))[0];
		assert.ok(event);
		assert.strictEqual(event.cycleId, undefined);
	});
});
