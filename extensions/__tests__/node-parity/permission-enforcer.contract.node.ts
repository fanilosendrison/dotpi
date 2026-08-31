/**
 * Node parity target for permission-enforcer telemetry contracts.
 *
 * The retired source path was
 * extensions/__tests__/permission-enforcer.contract.test.ts.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { createEventSink } from "@fanilosendrison/event-sink";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "permission-enforcer-contract-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function readEvents(filePath: string): readonly Record<string, unknown>[] {
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
		assert.ok(event);
		const details = event.details as Record<string, unknown>;

		assert.strictEqual(event.agent, "pi");
		assert.strictEqual(event.namespace, "permission-enforcer");
		assert.strictEqual(event.eventType, "permission_state_change");
		assert.strictEqual(event.sessionId, "s1");
		assert.strictEqual(event.workspace, "/cwd");
		assert.strictEqual(event.timestamp, "2026-07-09T12:00:00.000Z");
		assert.notStrictEqual(event.eventId, undefined);
		assert.strictEqual(details.granted, true);
		assert.strictEqual(details.parentModel, "unknown");
		assert.strictEqual(details.thinkingLevel, "xhigh");
		assert.strictEqual(details.matchSource, "slash");
		assert.strictEqual(details.promptLength, 16);
		assert.strictEqual(details.promptSnippet, undefined);
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
		assert.ok(events[0]);
		assert.ok(events[1]);
		assert.strictEqual(
			(events[0].details as Record<string, unknown>).matchSource,
			"skill-tag",
		);
		assert.strictEqual(
			(events[1].details as Record<string, unknown>).matchSource,
			"none",
		);
	});
});
