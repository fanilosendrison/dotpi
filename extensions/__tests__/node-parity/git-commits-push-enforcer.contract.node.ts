/**
 * Node parity target for git-commits-push-enforcer telemetry contracts.
 *
 * The retired source path was
 * extensions/__tests__/git-commits-push-enforcer.contract.test.ts.
 */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, test } from "node:test";
import { createEventSink } from "@fanilosendrison/event-sink";

interface TelemetryEvent {
	readonly eventType: string;
	readonly namespace: string;
	readonly agent: string;
	readonly sessionId: string;
	readonly workspace: string;
	readonly timestamp: string;
	readonly eventId: string;
	readonly details: Readonly<Record<string, unknown>>;
}

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "gcpe-contract-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function readEvents(filePath: string): readonly TelemetryEvent[] {
	return readFileSync(filePath, "utf-8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((line) => JSON.parse(line) as TelemetryEvent);
}

describe("enforcer_triggered contract", () => {
	test("writes enforcer_triggered with all fields", () => {
		const sink = createEventSink({
			statsDir: tmpDir,
			agent: "pi",
			namespace: "git-commits-push-enforcer",
			sessionId: "s1",
			workspace: "/cwd",
		});

		sink.append(
			"enforcer_triggered",
			{
				rawCommand: "/git-commits-push",
				detectedBy: "git-commits-push",
				toolCallId: "tcid-abc",
				parentModel: "deepseek-v4-pro",
				thinkingLevel: "xhigh",
			},
			{ timestamp: "2026-07-04T12:00:00.000Z" },
		);

		const event = readEvents(join(tmpDir, "events.jsonl"))[0];
		assert.ok(event);
		assert.strictEqual(event.eventType, "enforcer_triggered");
		assert.strictEqual(event.namespace, "git-commits-push-enforcer");
		assert.strictEqual(event.agent, "pi");
		assert.strictEqual(event.sessionId, "s1");
		assert.strictEqual(event.workspace, "/cwd");
		assert.strictEqual(event.details.rawCommand, "/git-commits-push");
		assert.strictEqual(event.details.detectedBy, "git-commits-push");
		assert.strictEqual(event.details.toolCallId, "tcid-abc");
		assert.strictEqual(event.details.parentModel, "deepseek-v4-pro");
		assert.strictEqual(event.details.thinkingLevel, "xhigh");
		assert.strictEqual(event.details.mutation, undefined);
		assert.strictEqual(event.timestamp, "2026-07-04T12:00:00.000Z");
		assert.notStrictEqual(event.eventId, undefined);
	});

	test("detectedBy can be git-commits-push", () => {
		const sink = createEventSink({
			statsDir: tmpDir,
			agent: "pi",
			namespace: "git-commits-push-enforcer",
			sessionId: "s1",
			workspace: "/cwd",
		});

		sink.append(
			"enforcer_triggered",
			{
				rawCommand: "/git-commits-push",
				detectedBy: "git-commits-push",
				toolCallId: "tcid-2",
				parentModel: "m1",
				thinkingLevel: "low",
			},
			{ timestamp: "t1" },
		);

		const event = readEvents(join(tmpDir, "events.jsonl"))[0];
		assert.ok(event);
		assert.strictEqual(event.details.detectedBy, "git-commits-push");
	});
});

describe("raw git mutation decision contracts", () => {
	test("writes blocked with mutation details", () => {
		const sink = createEventSink({
			statsDir: tmpDir,
			agent: "pi",
			namespace: "git-commits-push-enforcer",
			sessionId: "s1",
			workspace: "/cwd",
		});

		sink.append(
			"blocked",
			{
				rawCommand: "git push origin main",
				detectedBy: "git-commit",
				toolCallId: "tcid-push",
				parentModel: "deepseek-v4-pro",
				thinkingLevel: "xhigh",
				mutation: "push",
			},
			{ timestamp: "2026-07-10T12:00:00.000Z" },
		);

		const event = readEvents(join(tmpDir, "events.jsonl"))[0];
		assert.ok(event);
		assert.strictEqual(event.eventType, "blocked");
		assert.strictEqual(event.namespace, "git-commits-push-enforcer");
		assert.strictEqual(event.agent, "pi");
		assert.strictEqual(event.details.rawCommand, "git push origin main");
		assert.strictEqual(event.details.detectedBy, "git-commit");
		assert.strictEqual(event.details.toolCallId, "tcid-push");
		assert.strictEqual(event.details.parentModel, "deepseek-v4-pro");
		assert.strictEqual(event.details.thinkingLevel, "xhigh");
		assert.strictEqual(event.details.mutation, "push");
	});

	test("writes skipped when bypass is active", () => {
		const sink = createEventSink({
			statsDir: tmpDir,
			agent: "pi",
			namespace: "git-commits-push-enforcer",
			sessionId: "s1",
			workspace: "/cwd",
		});

		sink.append(
			"skipped",
			{
				rawCommand: "git commit -m 'fix: x'",
				detectedBy: "git-commit",
				toolCallId: "tcid-bypass",
				parentModel: "deepseek-v4-pro",
				thinkingLevel: "xhigh",
				mutation: "commit",
				reason: "bypass-enforcer",
			},
			{ timestamp: "2026-07-10T12:00:00.000Z" },
		);

		const event = readEvents(join(tmpDir, "events.jsonl"))[0];
		assert.ok(event);
		assert.strictEqual(event.eventType, "skipped");
		assert.strictEqual(event.details.reason, "bypass-enforcer");
		assert.strictEqual(event.details.mutation, "commit");
	});
});

describe("single event per trigger", () => {
	test("one append call produces one event", () => {
		const sink = createEventSink({
			statsDir: tmpDir,
			agent: "pi",
			namespace: "git-commits-push-enforcer",
			sessionId: "s1",
			workspace: "/cwd",
		});

		sink.append(
			"enforcer_triggered",
			{
				rawCommand: "/git-commits-push",
				detectedBy: "git-commits-push",
				toolCallId: "tc1",
				parentModel: "m1",
				thinkingLevel: "xhigh",
			},
			{ timestamp: "t1" },
		);

		const events = readEvents(join(tmpDir, "events.jsonl"));
		assert.strictEqual(events.length, 1);
		assert.ok(events[0]);
		assert.strictEqual(events[0].eventType, "enforcer_triggered");
	});
});
