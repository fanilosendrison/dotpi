/**
 * Tests for post-write-linter stats-log module.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createStatsLog } from "../stats-log";

const TMP_DIR = path.join(os.tmpdir(), "pwl-test-" + Date.now());

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
		.map((line) => JSON.parse(line));
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
	test("creates events.jsonl on first addLintError", () => {
		const dir = makeStatsDir("file");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.addLintError({
			ts: "t1",
			filePath: "/a.ts",
			language: "ts",
			output: "error msg",
		});

		expect(fs.existsSync(log.filePath)).toBe(true);
		expect(readEvents(log.filePath).length).toBe(1);
	});

	test("creates parent directory if missing", () => {
		const dir = path.join(TMP_DIR, "a", "b", "c");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.addLintError({
			ts: "t1",
			filePath: "/a.ts",
			language: "ts",
			output: "e",
		});

		expect(fs.existsSync(log.filePath)).toBe(true);
	});
});

// ── 2. addLintError ──────────────────────────────────────────────────────

describe("addLintError", () => {
	test("writes a valid JSON line with all required fields", () => {
		const dir = makeStatsDir("error");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.addLintError({
			ts: "2026-07-04T12:00:00.000Z",
			filePath: "/src/foo.ts",
			language: "ts",
			output: "error[noUnusedVars]: 'x' is never read",
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.extension).toBe("post-write-linter");
		expect(ev.eventType).toBe("lint_error");
		expect(ev.agent).toBe("pi");
		expect(ev.sessionId).toBe("s1");
		expect(ev.workspace).toBe("/cwd");
		expect(ev.details.filePath).toBe("/src/foo.ts");
		expect(ev.details.language).toBe("ts");
		expect(ev.details.output).toBe("error[noUnusedVars]: 'x' is never read");
		expect(ev.timestamp).toBe("2026-07-04T12:00:00.000Z");
		expect(ev.eventId).toBeDefined();
		expect(ev.cycleId).toBeDefined();
	});

	test("truncates output to 500 characters", () => {
		const dir = makeStatsDir("trunc");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		const longOutput = "x".repeat(600);
		log.addLintError({
			ts: "t1",
			filePath: "/a.ts",
			language: "ts",
			output: longOutput,
		});

		expect(readEvents(log.filePath)[0].details.output.length).toBe(501);
		expect(readEvents(log.filePath)[0].details.output.endsWith("…")).toBe(true);
	});

	test("does not truncate short outputs", () => {
		const dir = makeStatsDir("short");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.addLintError({
			ts: "t1",
			filePath: "/a.ts",
			language: "ts",
			output: "short error",
		});

		expect(readEvents(log.filePath)[0].details.output).toBe("short error");
	});
});

// ── 3. incClean + session_summary ────────────────────────────────────────

describe("session_summary", () => {
	test("writes correct errorRate", () => {
		const dir = makeStatsDir("summary");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		// 3 errors out of 15 total → 0.2
		for (let i = 0; i < 12; i++) log.incClean();
		log.addLintError({
			ts: "t1",
			filePath: "/a.ts",
			language: "ts",
			output: "e1",
		});
		log.addLintError({
			ts: "t2",
			filePath: "/b.ts",
			language: "ts",
			output: "e2",
		});
		log.addLintError({
			ts: "t3",
			filePath: "/c.js",
			language: "js",
			output: "e3",
		});

		log.flushSummary({
			endTs: "t4",
			model: "deepseek-v4-flash",
			totalTurns: 5,
		});

		const events = readEvents(log.filePath);
		expect(events.length).toBe(4); // 3 errors + 1 summary

		const s = events[3];
		expect(s.eventType).toBe("session_summary");
		expect(s.details.model).toBe("deepseek-v4-flash");
		expect(s.details.totalChecked).toBe(15);
		expect(s.details.errors).toBe(3);
		expect(s.details.clean).toBe(12);
		expect(s.details.errorRate).toBeCloseTo(0.2, 1);
	});

	test("is silent when no events", () => {
		const dir = makeStatsDir("silent");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.flushSummary({ endTs: "t1", totalTurns: 0 });

		expect(fs.existsSync(log.filePath)).toBe(false);
	});

	test("resets counters after flush", () => {
		const dir = makeStatsDir("reset");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.addLintError({
			ts: "t1",
			filePath: "/a.ts",
			language: "ts",
			output: "e",
		});
		log.flushSummary({ endTs: "t2", model: "m1", totalTurns: 1 });

		log.flushSummary({ endTs: "t3", totalTurns: 2 });

		const events = readEvents(log.filePath);
		expect(events.length).toBe(2); // error + first summary only
	});

	test("errorRate is 0 when only clean files", () => {
		const dir = makeStatsDir("all-clean");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.incClean();
		log.incClean();
		log.flushSummary({ endTs: "t1", model: "m1", totalTurns: 1 });

		const s = readEvents(log.filePath)[0];
		expect(s.details.errors).toBe(0);
		expect(s.details.totalChecked).toBe(2);
		expect(s.details.errorRate).toBe(0);
	});
});

// ── 4. Schema compliance ────────────────────────────────────────────────

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

		log.addLintError({
			ts: "t1",
			filePath: "/a.ts",
			language: "ts",
			output: "e",
		});
		log.flushSummary({ endTs: "t2", totalTurns: 1 });

		for (const ev of readEvents(log.filePath)) {
			for (const f of required) expect(ev[f]).toBeDefined();
			expect(ev.extension).toBe("post-write-linter");
			expect(ev.agent).toBe("pi");
		}
	});
});
