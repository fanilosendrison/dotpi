/**
 * Tests for secret-scanner stats-log module.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createStatsLog } from "../stats-log";

const TMP_DIR = path.join(os.tmpdir(), "secret-scanner-test-" + Date.now());

function makeStatsDir(name: string): string {
	const dir = path.join(TMP_DIR, name);
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function readEvents(filePath: string): any[] {
	if (!fs.existsSync(filePath)) return [];
	return fs
		.readFileSync(filePath, "utf-8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l));
}

beforeEach(() => {
	if (fs.existsSync(TMP_DIR))
		fs.rmSync(TMP_DIR, { recursive: true, force: true });
});
afterEach(() => {
	if (fs.existsSync(TMP_DIR))
		fs.rmSync(TMP_DIR, { recursive: true, force: true });
});

// ── 1. File creation ─────────────────────────────────────────────────────

describe("file creation", () => {
	test("creates events.jsonl on first logResult", () => {
		const dir = makeStatsDir("file");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });
		log.logResult({
			ts: "t1",
			status: "blocked",
			findings: [{ name: "AWS Access Key", line: "AKIAxxx", lineNumber: 1 }],
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});
		expect(fs.existsSync(log.filePath)).toBe(true);
		expect(readEvents(log.filePath).length).toBe(1);
	});

	test("creates parent directory if missing", () => {
		const dir = path.join(TMP_DIR, "a", "b");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });
		log.logResult({
			ts: "t1",
			status: "clean",
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});
		expect(fs.existsSync(log.filePath)).toBe(true);
	});
});

// ── 2. logResult (blocked) ──────────────────────────────────────────────

describe("logResult (blocked)", () => {
	test("writes scan_result with blocked status and findings", () => {
		const dir = makeStatsDir("block");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.logResult({
			ts: "2026-07-04T12:00:00.000Z",
			status: "blocked",
			findings: [
				{ name: "AWS Access Key", line: "AKIA...FAKE-KEY...", lineNumber: 12 },
			],
			parentModel: "deepseek-v4-pro",
			thinkingLevel: "xhigh",
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.eventType).toBe("scan_result");
		expect(ev.extension).toBe("secret-scanner");
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
		const dir = makeStatsDir("trunc");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.logResult({
			ts: "t1",
			status: "blocked",
			findings: [{ name: "test", line: "a".repeat(200), lineNumber: 1 }],
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.details.findings[0].line.length).toBe(80);
		expect(ev.details.findings[0].line.endsWith("…")).toBe(true);
	});

	test("does not truncate short finding line", () => {
		const dir = makeStatsDir("shortline");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.logResult({
			ts: "t1",
			status: "blocked",
			findings: [{ name: "test", line: "short secret here", lineNumber: 5 }],
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.details.findings[0].line).toBe("short secret here");
		expect(ev.details.findings[0].lineNumber).toBe(5);
	});

	test("accepts optional commitMsg (truncated to 100 chars)", () => {
		const dir = makeStatsDir("msg");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.logResult({
			ts: "t1",
			status: "blocked",
			findings: [{ name: "test", line: "xxx", lineNumber: 1 }],
			commitMsg: "x".repeat(200),
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});

		expect(readEvents(log.filePath)[0].details.commitMsg.length).toBe(100);
	});

	test("does not truncate short commitMsg", () => {
		const dir = makeStatsDir("shortmsg");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.logResult({
			ts: "t1",
			status: "blocked",
			findings: [{ name: "test", line: "xxx", lineNumber: 1 }],
			commitMsg: "feat(api): add endpoint",
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});

		expect(readEvents(log.filePath)[0].details.commitMsg).toBe(
			"feat(api): add endpoint",
		);
	});
});

// ── 3. logResult (clean) ────────────────────────────────────────────────

describe("logResult (clean)", () => {
	test("writes scan_result with clean status, no findings", () => {
		const dir = makeStatsDir("clean");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.logResult({
			ts: "t1",
			status: "clean",
			parentModel: "m1",
			thinkingLevel: "low",
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.details.status).toBe("clean");
		expect(ev.details.findings).toBeUndefined();
		expect(ev.details.findingsCount).toBeUndefined();
	});
});

// ── 4. Multiple events ──────────────────────────────────────────────────

describe("event accumulation", () => {
	test("appends clean and blocked in order", () => {
		const dir = makeStatsDir("multi");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.logResult({
			ts: "t1",
			status: "clean",
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});
		log.logResult({
			ts: "t2",
			status: "blocked",
			findings: [{ name: "AWS", line: "AKIAxxx", lineNumber: 1 }],
			parentModel: "m2",
			thinkingLevel: "low",
		});

		const ev = readEvents(log.filePath);
		expect(ev.length).toBe(2);
		expect(ev[0].details.status).toBe("clean");
		expect(ev[1].details.status).toBe("blocked");
	});
});

// ── 5. Schema compliance ────────────────────────────────────────────────

describe("schema compliance", () => {
	test("all events have required fields", () => {
		const dir = makeStatsDir("schema");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "suuid",
			cwd: "/w",
		});

		const required = [
			"timestamp",
			"eventId",
			"extension",
			"eventType",
			"agent",
			"workspace",
			"sessionId",
			"details",
		];

		log.logResult({
			ts: "t1",
			status: "clean",
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});

		for (const ev of readEvents(log.filePath)) {
			for (const f of required) expect(ev[f]).toBeDefined();
			expect(ev.extension).toBe("secret-scanner");
			expect(ev.agent).toBe("pi");
		}
	});

	test("no cycleId field present", () => {
		const dir = makeStatsDir("nocycle");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.logResult({
			ts: "t1",
			status: "clean",
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});

		expect(readEvents(log.filePath)[0].cycleId).toBeUndefined();
	});
});
