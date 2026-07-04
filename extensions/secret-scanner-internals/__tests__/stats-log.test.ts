/**
 * Tests for secret-scanner stats-log module.
 *
 * RED phase — tests define expected behavior before implementation.
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
	test("creates events.jsonl on first addBlock", () => {
		const dir = makeStatsDir("file");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });
		log.addBlock({
			ts: "t1",
			findings: [{ name: "AWS Access Key", line: "AKIAxxx", lineNumber: 1 }],
		});
		expect(fs.existsSync(log.filePath)).toBe(true);
		expect(readEvents(log.filePath).length).toBe(1);
	});

	test("creates parent directory if missing", () => {
		const dir = path.join(TMP_DIR, "a", "b");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });
		log.addBlock({
			ts: "t1",
			findings: [{ name: "AWS Access Key", line: "AKIAxxx", lineNumber: 1 }],
		});
		expect(fs.existsSync(log.filePath)).toBe(true);
	});
});

// ── 2. addBlock ──────────────────────────────────────────────────────────

describe("addBlock", () => {
	test("writes valid JSON with all required fields", () => {
		const dir = makeStatsDir("block");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.addBlock({
			ts: "2026-07-04T12:00:00.000Z",
			findings: [
				{
					name: "AWS Access Key",
					line: "AKIA...FAKE-KEY...",
					lineNumber: 12,
				},
			],
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.extension).toBe("secret-scanner");
		expect(ev.eventType).toBe("block");
		expect(ev.agent).toBe("pi");
		expect(ev.sessionId).toBe("s1");
		expect(ev.workspace).toBe("/cwd");
		expect(ev.timestamp).toBe("2026-07-04T12:00:00.000Z");
		expect(ev.eventId).toBeDefined();
		expect(ev.cycleId).toBeDefined();
	});

	test("includes findings list in details", () => {
		const dir = makeStatsDir("findings");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		const findings = [
			{ name: "AWS Access Key", line: "AKIAxxx", lineNumber: 3 },
			{
				name: "Private Key",
				line: "-----BEGIN FAKE PRIVATE KEY-----",
				lineNumber: 15,
			},
		];
		log.addBlock({ ts: "t1", findings });

		const ev = readEvents(log.filePath)[0];
		expect(ev.details.findingsCount).toBe(2);
		expect(ev.details.findings).toEqual(findings);
	});

	test("accepts optional commitMsg (truncated to 100 chars)", () => {
		const dir = makeStatsDir("msg");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		const longMsg = "x".repeat(200);
		log.addBlock({
			ts: "t1",
			findings: [{ name: "test", line: "xxx", lineNumber: 1 }],
			commitMsg: longMsg,
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.details.commitMsg.length).toBe(100);
	});

	test("works without commitMsg", () => {
		const dir = makeStatsDir("nomsg");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.addBlock({
			ts: "t1",
			findings: [{ name: "test", line: "xxx", lineNumber: 1 }],
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.details.commitMsg).toBeUndefined();
	});
});

// ── 3. addBlock — line truncation ────────────────────────────────────────

describe("line truncation in findings", () => {
	test("truncates finding line to 80 chars", () => {
		const dir = makeStatsDir("trunc");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		const longLine = "a".repeat(200);
		log.addBlock({
			ts: "t1",
			findings: [{ name: "test", line: longLine, lineNumber: 1 }],
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.details.findings[0].line.length).toBe(80);
		expect(ev.details.findings[0].line.endsWith("…")).toBe(true);
	});
});

// ── 4. session_summary ──────────────────────────────────────────────────

describe("session_summary", () => {
	test("writes correct blockRate and pattern counts", () => {
		const dir = makeStatsDir("summary");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		// Total: 5 scans, 2 blocks
		log.incTotal();
		log.incClean();
		log.incTotal();
		log.addBlock({
			ts: "t1",
			findings: [{ name: "AWS Access Key", line: "AKIAxxx", lineNumber: 1 }],
		});
		log.incTotal();
		log.incClean();
		log.incTotal();
		log.addBlock({
			ts: "t2",
			findings: [
				{ name: "GitHub Token", line: "ghp_xxx", lineNumber: 5 },
				{ name: "AWS Access Key", line: "AKIAyyy", lineNumber: 8 },
			],
		});
		log.incTotal();
		log.incClean();

		log.flushSummary({
			endTs: "t3",
			model: "deepseek-v4-flash",
			totalTurns: 5,
		});

		const events = readEvents(log.filePath);
		expect(events.length).toBe(3); // 2 blocks + 1 summary

		const s = events[2];
		expect(s.eventType).toBe("session_summary");
		expect(s.details.model).toBe("deepseek-v4-flash");
		expect(s.details.totalScans).toBe(5);
		expect(s.details.blocks).toBe(2);
		expect(s.details.clean).toBe(3);
		expect(s.details.blockRate).toBeCloseTo(0.4, 1); // 2/5

		// Patterns: dédupliqués, triés par fréquence
		expect(s.details.patterns).toEqual([
			{ name: "AWS Access Key", count: 2 },
			{ name: "GitHub Token", count: 1 },
		]);
	});

	test("is silent when no scans", () => {
		const dir = makeStatsDir("silent");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });
		log.flushSummary({ endTs: "t1", totalTurns: 0 });
		expect(fs.existsSync(log.filePath)).toBe(false);
	});

	test("writes session_summary with blockRate=0 when no blocks occurred", () => {
		const dir = makeStatsDir("onlyclean");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.incTotal();
		log.incClean();
		log.incTotal();
		log.incClean();

		log.flushSummary({ endTs: "t1", totalTurns: 2 });
		// Should still write session_summary even with blocks=0
		expect(fs.existsSync(log.filePath)).toBe(true);
		const events = readEvents(log.filePath);
		expect(events.length).toBe(1);
		expect(events[0].eventType).toBe("session_summary");
		expect(events[0].details.blocks).toBe(0);
		expect(events[0].details.blockRate).toBe(0);
	});

	test("resets counters after flush", () => {
		const dir = makeStatsDir("reset");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.incTotal();
		log.addBlock({
			ts: "t1",
			findings: [{ name: "AWS", line: "AKIAxxx", lineNumber: 1 }],
		});
		log.flushSummary({ endTs: "t2", model: "m1", totalTurns: 1 });

		// Second flush should produce nothing (no new scans)
		log.flushSummary({ endTs: "t3", totalTurns: 2 });

		expect(readEvents(log.filePath).length).toBe(2); // block + first summary only
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
			"cycleId",
			"details",
		];

		log.addBlock({
			ts: "t1",
			findings: [{ name: "AWS", line: "AKIAxxx", lineNumber: 1 }],
		});
		log.flushSummary({ endTs: "t2", totalTurns: 1 });

		for (const ev of readEvents(log.filePath)) {
			for (const f of required) expect(ev[f]).toBeDefined();
			expect(ev.extension).toBe("secret-scanner");
			expect(ev.agent).toBe("pi");
		}
	});
});

// ── 6. Multi-block session ──────────────────────────────────────────────

describe("multi-block session", () => {
	test("accumulates patterns across multiple blocks", () => {
		const dir = makeStatsDir("multi");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		// Block 1: AWS + GitHub
		log.incTotal();
		log.addBlock({
			ts: "t1",
			findings: [
				{ name: "AWS Access Key", line: "AKIA1", lineNumber: 1 },
				{ name: "GitHub Token", line: "ghp_1", lineNumber: 2 },
			],
		});

		// Clean
		log.incTotal();
		log.incClean();

		// Block 2: GitHub again + Slack
		log.incTotal();
		log.addBlock({
			ts: "t2",
			findings: [
				{ name: "GitHub Token", line: "ghp_2", lineNumber: 5 },
				{ name: "Slack Token", line: "xoxb-xxx", lineNumber: 6 },
			],
		});

		log.flushSummary({ endTs: "t3", totalTurns: 3 });

		const s = readEvents(log.filePath).find(
			(e) => e.eventType === "session_summary",
		);
		expect(s.details.totalScans).toBe(3);
		expect(s.details.blocks).toBe(2);
		expect(s.details.patterns).toEqual([
			{ name: "GitHub Token", count: 2 },
			{ name: "AWS Access Key", count: 1 },
			{ name: "Slack Token", count: 1 },
		]);
	});
});
