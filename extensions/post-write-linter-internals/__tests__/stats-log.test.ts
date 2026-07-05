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
	test("creates events.jsonl on first logResult", () => {
		const dir = makeStatsDir("file");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.logResult({
			ts: "t1",
			filePath: "/a.ts",
			language: "ts",
			status: "error",
			output: "error msg",
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});

		expect(fs.existsSync(log.filePath)).toBe(true);
		expect(readEvents(log.filePath).length).toBe(1);
	});

	test("creates parent directory if missing", () => {
		const dir = path.join(TMP_DIR, "a", "b", "c");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.logResult({
			ts: "t1",
			filePath: "/a.ts",
			language: "ts",
			status: "error",
			output: "e",
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});

		expect(fs.existsSync(log.filePath)).toBe(true);
	});
});

// ── 2. logResult (error) ────────────────────────────────────────────────

describe("logResult (error)", () => {
	test("writes lint_result with error status and all fields", () => {
		const dir = makeStatsDir("error");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.logResult({
			ts: "2026-07-04T12:00:00.000Z",
			filePath: "/src/foo.ts",
			language: "ts",
			status: "error",
			output: "error[noUnusedVars]: 'x' is never read",
			parentModel: "deepseek-v4-pro",
			thinkingLevel: "xhigh",
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.eventType).toBe("lint_result");
		expect(ev.extension).toBe("post-write-linter");
		expect(ev.agent).toBe("pi");
		expect(ev.sessionId).toBe("s1");
		expect(ev.workspace).toBe("/cwd");
		expect(ev.details.status).toBe("error");
		expect(ev.details.filePath).toBe("/src/foo.ts");
		expect(ev.details.language).toBe("ts");
		expect(ev.details.output).toBe("error[noUnusedVars]: 'x' is never read");
		expect(ev.details.parentModel).toBe("deepseek-v4-pro");
		expect(ev.details.thinkingLevel).toBe("xhigh");
		expect(ev.timestamp).toBe("2026-07-04T12:00:00.000Z");
		expect(ev.eventId).toBeDefined();
	});

	test("truncates output to 500 characters", () => {
		const dir = makeStatsDir("trunc");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.logResult({
			ts: "t1",
			filePath: "/a.ts",
			language: "ts",
			status: "error",
			output: "x".repeat(600),
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.details.output.length).toBe(501);
		expect(ev.details.output.endsWith("…")).toBe(true);
	});

	test("does not truncate short outputs", () => {
		const dir = makeStatsDir("short");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.logResult({
			ts: "t1",
			filePath: "/a.ts",
			language: "ts",
			status: "error",
			output: "short error",
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});

		expect(readEvents(log.filePath)[0].details.output).toBe("short error");
	});
});

// ── 3. logResult (success) ──────────────────────────────────────────────

describe("logResult (success)", () => {
	test("writes lint_result with success status, no output", () => {
		const dir = makeStatsDir("success");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.logResult({
			ts: "t1",
			filePath: "/b.ts",
			language: "ts",
			status: "success",
			parentModel: "m1",
			thinkingLevel: "low",
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.details.status).toBe("success");
		expect(ev.details.output).toBeUndefined();
	});
});

// ── 4. Multiple events ──────────────────────────────────────────────────

describe("event accumulation", () => {
	test("appends success and error in order", () => {
		const dir = makeStatsDir("multi");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.logResult({
			ts: "t1",
			filePath: "/a.ts",
			language: "ts",
			status: "success",
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});
		log.logResult({
			ts: "t2",
			filePath: "/b.ts",
			language: "ts",
			status: "error",
			output: "err",
			parentModel: "m2",
			thinkingLevel: "low",
		});

		const ev = readEvents(log.filePath);
		expect(ev.length).toBe(2);
		expect(ev[0].details.status).toBe("success");
		expect(ev[1].details.status).toBe("error");
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
			filePath: "/a.ts",
			language: "ts",
			status: "success",
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});

		for (const ev of readEvents(log.filePath)) {
			for (const f of required) expect(ev[f]).toBeDefined();
			expect(ev.extension).toBe("post-write-linter");
			expect(ev.agent).toBe("pi");
		}
	});

	test("no cycleId field present", () => {
		const dir = makeStatsDir("nocycle");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.logResult({
			ts: "t1",
			filePath: "/a.ts",
			language: "ts",
			status: "success",
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.cycleId).toBeUndefined();
	});
});
