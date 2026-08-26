/**
 * Contract tests for zero-timeout-filter events (via event-sink).
 *
 * Tests the DATA CONTRACT only:
 *   - namespace, eventType, details shape
 *   - all fields present
 *
 * Infrastructure (file creation, mkdir, ordering, required fields schema)
 * is covered by event-sink's own tests.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventSink } from "@fanilosendrison/event-sink";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "ztf-contract-"));
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

// ── timeout_stripped ─────────────────────────────────────────────────────

describe("timeout_stripped contract", () => {
	test("writes valid JSON with all fields", () => {
		const sink = createEventSink({
			statsDir: tmpDir,
			agent: "pi",
			namespace: "zero-timeout-filter",
		});

		sink.append(
			"timeout_stripped",
			{
				originalTimeout: 60,
				parentModel: "deepseek-v4-pro",
				thinkingLevel: "xhigh",
				toolCallId: "tcid-abc",
			},
			{
				timestamp: "2026-07-05T12:00:00.000Z",
				sessionId: "suuid",
				workspace: "/w",
			},
		);

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.namespace).toBe("zero-timeout-filter");
		expect(ev.eventType).toBe("timeout_stripped");
		expect(ev.agent).toBe("pi");
		expect(ev.sessionId).toBe("suuid");
		expect(ev.workspace).toBe("/w");
		expect(ev.details.originalTimeout).toBe(60);
		expect(ev.details.parentModel).toBe("deepseek-v4-pro");
		expect(ev.details.thinkingLevel).toBe("xhigh");
		expect(ev.details.toolCallId).toBe("tcid-abc");
		expect(ev.timestamp).toBe("2026-07-05T12:00:00.000Z");
		expect(ev.eventId).toBeDefined();
	});
});
