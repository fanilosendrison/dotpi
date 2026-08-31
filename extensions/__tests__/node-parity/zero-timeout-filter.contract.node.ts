/**
 * Node parity target for zero-timeout-filter telemetry contracts.
 *
 * The retired source path was
 * extensions/__tests__/zero-timeout-filter.contract.test.ts.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { createEventSink } from "@fanilosendrison/event-sink";

interface TimeoutStrippedEvent {
	readonly namespace: string;
	readonly eventType: string;
	readonly agent: string;
	readonly sessionId: string;
	readonly workspace: string;
	readonly timestamp: string;
	readonly eventId: string;
	readonly details: Readonly<Record<string, unknown>>;
}

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "ztf-contract-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function readEvents(filePath: string): readonly TimeoutStrippedEvent[] {
	return readFileSync(filePath, "utf-8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as TimeoutStrippedEvent);
}

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

		const event = readEvents(join(tmpDir, "events.jsonl"))[0];
		assert.ok(event);
		assert.strictEqual(event.namespace, "zero-timeout-filter");
		assert.strictEqual(event.eventType, "timeout_stripped");
		assert.strictEqual(event.agent, "pi");
		assert.strictEqual(event.sessionId, "suuid");
		assert.strictEqual(event.workspace, "/w");
		assert.strictEqual(event.details.originalTimeout, 60);
		assert.strictEqual(event.details.parentModel, "deepseek-v4-pro");
		assert.strictEqual(event.details.thinkingLevel, "xhigh");
		assert.strictEqual(event.details.toolCallId, "tcid-abc");
		assert.strictEqual(event.timestamp, "2026-07-05T12:00:00.000Z");
		assert.notStrictEqual(event.eventId, undefined);
	});
});
