/**
 * Contract tests for secret-scanner events (via event-sink).
 *
 * Tests the DATA CONTRACT only:
 *   - namespace, eventType, details shape
 *   - blocked status with findings (truncation at 80), findingsCount
 *   - clean status without findings
 *   - commitMsg truncation at 100
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
	tmpDir = mkdtempSync(join(tmpdir(), "ss-contract-"));
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
	namespace: "secret-scanner",
	sessionId: "s1",
	workspace: "/cwd",
};

// ── scan_result (blocked) ────────────────────────────────────────────────

describe("scan_result (blocked)", () => {
	test("writes scan_result with blocked status and findings", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		const details: Record<string, unknown> = {
			status: "blocked",
			parentModel: "deepseek-v4-pro",
			thinkingLevel: "xhigh",
		};
		const findings = [
			{ name: "AWS Access Key", line: "AKIA...FAKE-KEY...", lineNumber: 12 },
		];
		details.findingsCount = findings.length;
		details.findings = findings.map((f) => ({
			...f,
			line: f.line.length <= 80 ? f.line : f.line.slice(0, 79) + "…",
		}));

		sink.append("scan_result", details, {
			timestamp: "2026-07-04T12:00:00.000Z",
		});

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.eventType).toBe("scan_result");
		expect(ev.namespace).toBe("secret-scanner");
		expect(ev.agent).toBe("pi");
		expect(ev.sessionId).toBe("s1");
		expect(ev.workspace).toBe("/cwd");
		expect(ev.details.status).toBe("blocked");
		expect(ev.details.parentModel).toBe("deepseek-v4-pro");
		expect(ev.details.thinkingLevel).toBe("xhigh");
		expect(ev.details.findingsCount).toBe(1);
		expect(ev.details.findings[0].name).toBe("AWS Access Key");
		expect(ev.details.findings[0].line).toBe("AKIA...FAKE-KEY...");
		expect(ev.details.findings[0].lineNumber).toBe(12);
		expect(ev.timestamp).toBe("2026-07-04T12:00:00.000Z");
		expect(ev.eventId).toBeDefined();
		expect(ev.cycleId).toBeUndefined();
	});

	test("truncates finding line to 80 chars", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		const findings = [{ name: "test", line: "a".repeat(200), lineNumber: 1 }];
		const details: Record<string, unknown> = {
			status: "blocked",
			parentModel: "m1",
			thinkingLevel: "xhigh",
			findingsCount: findings.length,
			findings: findings.map((f) => ({
				...f,
				line: f.line.length <= 80 ? f.line : f.line.slice(0, 79) + "…",
			})),
		};

		sink.append("scan_result", details, { timestamp: "t1" });

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.details.findings[0].line.length).toBe(80);
		expect(ev.details.findings[0].line.endsWith("…")).toBe(true);
	});

	test("does not truncate short finding line", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		const findings = [
			{ name: "test", line: "short secret here", lineNumber: 5 },
		];
		const details: Record<string, unknown> = {
			status: "blocked",
			parentModel: "m1",
			thinkingLevel: "xhigh",
			findingsCount: findings.length,
			findings: findings.map((f) => ({
				...f,
				line: f.line.length <= 80 ? f.line : f.line.slice(0, 79) + "…",
			})),
		};

		sink.append("scan_result", details, { timestamp: "t1" });

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.details.findings[0].line).toBe("short secret here");
		expect(ev.details.findings[0].lineNumber).toBe(5);
	});

	test("accepts optional commitMsg (truncated to 100 chars)", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		const findings = [{ name: "test", line: "xxx", lineNumber: 1 }];
		const commitMsg = "x".repeat(200);
		const commitMsgTruncated =
			commitMsg.length <= 100 ? commitMsg : commitMsg.slice(0, 99) + "…";

		const details: Record<string, unknown> = {
			status: "blocked",
			parentModel: "m1",
			thinkingLevel: "xhigh",
			findingsCount: findings.length,
			findings: findings.map((f) => ({
				...f,
				line: f.line.length <= 80 ? f.line : f.line.slice(0, 79) + "…",
			})),
			commitMsg: commitMsgTruncated,
		};

		sink.append("scan_result", details, { timestamp: "t1" });

		expect(
			readEvents(join(tmpDir, "events.jsonl"))[0].details.commitMsg.length,
		).toBe(100);
	});

	test("does not truncate short commitMsg", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		const findings = [{ name: "test", line: "xxx", lineNumber: 1 }];
		const commitMsg = "feat(api): add endpoint";

		const details: Record<string, unknown> = {
			status: "blocked",
			parentModel: "m1",
			thinkingLevel: "xhigh",
			findingsCount: findings.length,
			findings: findings.map((f) => ({
				...f,
				line: f.line.length <= 80 ? f.line : f.line.slice(0, 79) + "…",
			})),
			commitMsg,
		};

		sink.append("scan_result", details, { timestamp: "t1" });

		expect(readEvents(join(tmpDir, "events.jsonl"))[0].details.commitMsg).toBe(
			"feat(api): add endpoint",
		);
	});
});

// ── scan_result (clean) ──────────────────────────────────────────────────

describe("scan_result (clean)", () => {
	test("writes scan_result with clean status, no findings", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		sink.append(
			"scan_result",
			{
				status: "clean",
				parentModel: "m1",
				thinkingLevel: "low",
			},
			{ timestamp: "t1" },
		);

		const ev = readEvents(join(tmpDir, "events.jsonl"))[0];
		expect(ev.details.status).toBe("clean");
		expect(ev.details.findings).toBeUndefined();
		expect(ev.details.findingsCount).toBeUndefined();
	});
});

// ── Schema compliance (contract-specific) ────────────────────────────────

describe("schema compliance", () => {
	test("no cycleId field present", () => {
		const sink = createEventSink({ statsDir: tmpDir, ...BASE });

		sink.append(
			"scan_result",
			{
				status: "clean",
				parentModel: "m1",
				thinkingLevel: "xhigh",
			},
			{ timestamp: "t1" },
		);

		expect(readEvents(join(tmpDir, "events.jsonl"))[0].cycleId).toBeUndefined();
	});
});
