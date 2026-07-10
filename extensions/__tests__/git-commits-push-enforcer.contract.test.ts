/**
 * Contract tests for git-commits-push-enforcer events (via event-sink).
 *
 * Tests the DATA CONTRACT only:
 *   - namespace, eventType, details shape
 *   - one event per append
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

interface TelemetryEvent {
	eventType: string;
	namespace: string;
	agent: string;
	sessionId: string;
	workspace: string;
	timestamp: string;
	eventId: string;
	details: Record<string, unknown>;
}

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "gcpe-contract-"));
});

afterEach(() => {
	rmSync(tmpDir, { recursive: true, force: true });
});

function readEvents(filePath: string): TelemetryEvent[] {
	return readFileSync(filePath, "utf-8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l) as TelemetryEvent);
}

// ── logTriggered → enforcer_triggered ────────────────────────────────────

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

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.eventType).toBe("enforcer_triggered");
		expect(ev.namespace).toBe("git-commits-push-enforcer");
		expect(ev.agent).toBe("pi");
		expect(ev.sessionId).toBe("s1");
		expect(ev.workspace).toBe("/cwd");
		expect(ev.details.rawCommand).toBe("/git-commits-push");
		expect(ev.details.detectedBy).toBe("git-commits-push");
		expect(ev.details.toolCallId).toBe("tcid-abc");
		expect(ev.details.parentModel).toBe("deepseek-v4-pro");
		expect(ev.details.thinkingLevel).toBe("xhigh");
		expect(ev.details.mutation).toBeUndefined();
		expect(ev.timestamp).toBe("2026-07-04T12:00:00.000Z");
		expect(ev.eventId).toBeDefined();
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

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.details.detectedBy).toBe("git-commits-push");
	});
});

// ── raw git mutation decisions ───────────────────────────────────────────

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

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.eventType).toBe("blocked");
		expect(ev.namespace).toBe("git-commits-push-enforcer");
		expect(ev.agent).toBe("pi");
		expect(ev.details.rawCommand).toBe("git push origin main");
		expect(ev.details.detectedBy).toBe("git-commit");
		expect(ev.details.toolCallId).toBe("tcid-push");
		expect(ev.details.parentModel).toBe("deepseek-v4-pro");
		expect(ev.details.thinkingLevel).toBe("xhigh");
		expect(ev.details.mutation).toBe("push");
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

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.eventType).toBe("skipped");
		expect(ev.details.reason).toBe("bypass-enforcer");
		expect(ev.details.mutation).toBe("commit");
	});
});

// ── Single event per trigger ─────────────────────────────────────────────

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

		const ev = readEvents(join(tmpDir, "events.jsonl"));
		expect(ev.length).toBe(1);
		expect(ev[0].eventType).toBe("enforcer_triggered");
	});
});
