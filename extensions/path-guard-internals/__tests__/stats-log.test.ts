/**
 * Tests for path-guard stats-log module.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createStatsLog } from "../stats-log";

const TMP_DIR = path.join(os.tmpdir(), "path-guard-test-" + Date.now());

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
	test("creates events.jsonl on first logAccess", () => {
		const dir = makeStatsDir("file");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/test",
		});
		log.logAccess({
			ts: "t1",
			toolType: "write",
			repo: "dotpi",
			action: "redirected",
			givenPath: "/dotpi/foo.ts",
			rewrittenTo: "/.pi/agent/foo.ts",
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});
		expect(fs.existsSync(log.filePath)).toBe(true);
		expect(readEvents(log.filePath).length).toBe(1);
	});

	test("creates parent directory if missing", () => {
		const dir = path.join(TMP_DIR, "a", "b");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/test",
		});
		log.logAccess({
			ts: "t1",
			toolType: "edit",
			repo: "dotagents",
			action: "correct",
			givenPath: "/dotagents/doc.md",
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});
		expect(fs.existsSync(log.filePath)).toBe(true);
	});
});

// ── 2. logAccess ─────────────────────────────────────────────────────────

describe("logAccess", () => {
	test("writes path_access with all fields (redirected)", () => {
		const dir = makeStatsDir("redirected");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.logAccess({
			ts: "2026-07-04T12:00:00.000Z",
			toolType: "write",
			repo: "dotpi",
			action: "redirected",
			givenPath: "/dotpi/foo.ts",
			rewrittenTo: "/.pi/agent/foo.ts",
			parentModel: "deepseek-v4-flash",
			thinkingLevel: "xhigh",
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.eventType).toBe("path_access");
		expect(ev.extension).toBe("path-guard");
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

	test("writes path_access for correct actions without rewrittenTo", () => {
		const dir = makeStatsDir("correct");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.logAccess({
			ts: "t1",
			toolType: "bash",
			repo: "dotpi",
			action: "correct",
			givenPath: "/dotpi/cmd",
			parentModel: "m1",
			thinkingLevel: "low",
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.details.action).toBe("correct");
		expect(ev.details.rewrittenTo).toBeUndefined();
		expect(ev.details.originalCmd).toBeUndefined();
	});

	test("truncates originalCmd to 200 chars", () => {
		const dir = makeStatsDir("truncate");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.logAccess({
			ts: "t1",
			toolType: "bash",
			repo: "dotpi",
			action: "redirected",
			givenPath: "/x",
			rewrittenTo: "/y",
			originalCmd: "x".repeat(250),
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.details.originalCmd.length).toBe(201);
		expect(ev.details.originalCmd.endsWith("…")).toBe(true);
	});
});

// ── 3. Multiple events ──────────────────────────────────────────────────

describe("event accumulation", () => {
	test("appends redirected and correct events in order", () => {
		const dir = makeStatsDir("multi");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.logAccess({
			ts: "t1",
			toolType: "write",
			repo: "dotpi",
			action: "redirected",
			givenPath: "/a.ts",
			rewrittenTo: "/b.ts",
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});
		log.logAccess({
			ts: "t2",
			toolType: "bash",
			repo: "dotagents",
			action: "correct",
			givenPath: "/c",
			parentModel: "m2",
			thinkingLevel: "low",
		});

		const ev = readEvents(log.filePath);
		expect(ev.length).toBe(2);
		expect(ev[0].details.action).toBe("redirected");
		expect(ev[1].details.action).toBe("correct");
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
			"details",
		];

		log.logAccess({
			ts: "t1",
			toolType: "edit",
			repo: "dotpi",
			action: "redirected",
			givenPath: "/a",
			rewrittenTo: "/b",
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});

		for (const ev of readEvents(log.filePath)) {
			for (const f of required) expect(ev[f]).toBeDefined();
			expect(ev.extension).toBe("path-guard");
			expect(ev.agent).toBe("pi");
		}
	});

	test("no cycleId field present", () => {
		const dir = makeStatsDir("nocycle");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "suuid",
			cwd: "/w",
		});

		log.logAccess({
			ts: "t1",
			toolType: "bash",
			repo: "dotpi",
			action: "redirected",
			givenPath: "/a",
			rewrittenTo: "/b",
			originalCmd: "cmd",
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.cycleId).toBeUndefined();
	});
});

// ── 5. Concurrent safety ────────────────────────────────────────────────

describe("concurrent safety", () => {
	test("appends to existing file without overwriting", () => {
		const dir = makeStatsDir("concurrent");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.logAccess({
			ts: "t1",
			toolType: "edit",
			repo: "dotpi",
			action: "redirected",
			givenPath: "/a",
			rewrittenTo: "/b",
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});
		log.logAccess({
			ts: "t2",
			toolType: "bash",
			repo: "dotagents",
			action: "correct",
			givenPath: "/c",
			parentModel: "m2",
			thinkingLevel: "low",
		});

		const ev = readEvents(log.filePath);
		expect(ev.length).toBe(2);
		expect(ev[0].details.action).toBe("redirected");
		expect(ev[1].details.action).toBe("correct");
	});
});
