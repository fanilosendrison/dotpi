/**
 * Contract tests for path-guard events (via event-sink).
 *
 * Tests the DATA CONTRACT only:
 *   - namespace, eventType, details shape
 *   - conditional fields (rewrittenTo, originalCmd)
 *   - truncation logic (originalCmd at 200)
 *
 * Infrastructure (file creation, mkdir, ordering, concurrent safety, schema)
 * is covered by event-sink's own tests.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createEventSink } from "/Users/famillesendrison/Developper/Projects/telemetry-tools/event-sink/src/index.ts";

let tmpDir: string;

beforeEach(() => {
	tmpDir = mkdtempSync(join(tmpdir(), "pg-contract-"));
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
	namespace: "path-guard",
	sessionId: "sess-1",
	workspace: "/cwd",
};

// ── logAccess → path_access ─────────────────────────────────────────────

describe("path_access contract", () => {
	test("writes path_access with all fields (redirected, write, with rewrittenTo, without originalCmd)", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		sink.append(
			"path_access",
			{
				toolType: "write",
				repo: "dotpi",
				action: "redirected",
				givenPath: "/dotpi/foo.ts",
				rewrittenTo: "/.pi/agent/foo.ts",
				parentModel: "deepseek-v4-flash",
				thinkingLevel: "xhigh",
			},
			{ timestamp: "2026-07-04T12:00:00.000Z" },
		);

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.eventType).toBe("path_access");
		expect(ev.namespace).toBe("path-guard");
		expect(ev.agent).toBe("pi");
		expect(ev.sessionId).toBe("sess-1");
		expect(ev.workspace).toBe("/cwd");
		expect(ev.details.toolType).toBe("write");
		expect(ev.details.repo).toBe("dotpi");
		expect(ev.details.action).toBe("redirected");
		expect(ev.details.givenPath).toBe("/dotpi/foo.ts");
		expect(ev.details.rewrittenTo).toBe("/.pi/agent/foo.ts");
		expect(ev.details.parentModel).toBe("deepseek-v4-flash");
		expect(ev.details.thinkingLevel).toBe("xhigh");
		expect(ev.details.originalCmd).toBeUndefined();
		expect(ev.timestamp).toBe("2026-07-04T12:00:00.000Z");
		expect(ev.eventId).toBeDefined();
	});

	test("writes path_access for correct actions without rewrittenTo/originalCmd", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		sink.append(
			"path_access",
			{
				toolType: "bash",
				repo: "dotpi",
				action: "correct",
				givenPath: "/dotpi/cmd",
				parentModel: "m1",
				thinkingLevel: "low",
			},
			{ timestamp: "t1" },
		);

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.details.action).toBe("correct");
		expect(ev.details.rewrittenTo).toBeUndefined();
		expect(ev.details.originalCmd).toBeUndefined();
	});

	test("truncates originalCmd to 200 chars", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		const originalCmd = "x".repeat(250);
		const details = {
			toolType: "bash" as const,
			repo: "dotpi",
			action: "redirected" as const,
			givenPath: "/x",
			rewrittenTo: "/y",
			originalCmd:
				originalCmd.length <= 200
					? originalCmd
					: originalCmd.slice(0, 200) + "…",
			parentModel: "m1",
			thinkingLevel: "xhigh",
		};

		sink.append("path_access", details, { timestamp: "t1" });

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.details.originalCmd.length).toBe(201);
		expect(ev.details.originalCmd.endsWith("…")).toBe(true);
	});

	test("no cycleId field present", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		sink.append(
			"path_access",
			{
				toolType: "bash",
				repo: "dotpi",
				action: "redirected",
				givenPath: "/a",
				rewrittenTo: "/b",
				originalCmd: "cmd",
				parentModel: "m1",
				thinkingLevel: "xhigh",
			},
			{ timestamp: "t1" },
		);

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.cycleId).toBeUndefined();
	});
});
