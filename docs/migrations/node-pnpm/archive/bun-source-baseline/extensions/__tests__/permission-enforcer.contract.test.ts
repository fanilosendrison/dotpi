/**
 * Contract tests for permission-enforcer events (via event-sink).
 *
 * Tests the data contract only. File creation and atomic write behavior are
 * covered by event-sink's own tests.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventSink } from "@fanilosendrison/event-sink";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "permission-enforcer-contract-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function readEvents(filePath: string): Array<Record<string, unknown>> {
	return readFileSync(filePath, "utf-8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe("permission_state_change contract", () => {
	test("writes permission_state_change with all contract fields", () => {
		const sink = createEventSink({
			statsDir: tmpDir,
			agent: "pi",
			namespace: "permission-enforcer",
			sessionId: "s1",
			workspace: "/cwd",
		});

		sink.append(
			"permission_state_change",
			{
				granted: true,
				parentModel: "unknown",
				thinkingLevel: "xhigh",
				matchSource: "slash",
				promptLength: 16,
			},
			{ timestamp: "2026-07-09T12:00:00.000Z" },
		);

		const event = readEvents(join(tmpDir, "events.jsonl"))[0];
		const details = event.details as Record<string, unknown>;

		expect(event.agent).toBe("pi");
		expect(event.namespace).toBe("permission-enforcer");
		expect(event.eventType).toBe("permission_state_change");
		expect(event.sessionId).toBe("s1");
		expect(event.workspace).toBe("/cwd");
		expect(event.timestamp).toBe("2026-07-09T12:00:00.000Z");
		expect(event.eventId).toBeDefined();
		expect(details.granted).toBe(true);
		expect(details.parentModel).toBe("unknown");
		expect(details.thinkingLevel).toBe("xhigh");
		expect(details.matchSource).toBe("slash");
		expect(details.promptLength).toBe(16);
		expect(details.promptSnippet).toBeUndefined();
	});

	test("matchSource supports skill-tag and none", () => {
		const sink = createEventSink({
			statsDir: tmpDir,
			agent: "pi",
			namespace: "permission-enforcer",
			sessionId: "s1",
			workspace: "/cwd",
		});

		sink.append("permission_state_change", {
			granted: true,
			parentModel: "m1",
			thinkingLevel: "low",
			matchSource: "skill-tag",
			promptLength: 34,
		});
		sink.append("permission_state_change", {
			granted: false,
			parentModel: "m1",
			thinkingLevel: "low",
			matchSource: "none",
			promptLength: 12,
		});

		const events = readEvents(join(tmpDir, "events.jsonl"));
		expect((events[0].details as Record<string, unknown>).matchSource).toBe(
			"skill-tag",
		);
		expect((events[1].details as Record<string, unknown>).matchSource).toBe(
			"none",
		);
	});
});
