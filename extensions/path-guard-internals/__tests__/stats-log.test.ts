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
	test("creates events.jsonl on first logRedirected", () => {
		const dir = makeStatsDir("file");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/test",
		});
		log.logRedirected({
			ts: "t1",
			toolType: "write",
			repo: "dotpi",
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
		log.logRedirected({
			ts: "t1",
			toolType: "edit",
			repo: "dotagents",
			givenPath: "/src/doc.md",
			rewrittenTo: "~/.agents/doc.md",
			parentModel: "m1",
			thinkingLevel: "xhigh",
		});
		expect(fs.existsSync(log.filePath)).toBe(true);
	});
});

// ── 2. logRedirected ────────────────────────────────────────────────────

describe("logRedirected", () => {
	test("writes path_redirected with all fields (write)", () => {
		const dir = makeStatsDir("redirect-write");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.logRedirected({
			ts: "2026-07-04T12:00:00.000Z",
			toolType: "write",
			repo: "dotpi",
			givenPath: "/dotpi/foo.ts",
			rewrittenTo: "/.pi/agent/foo.ts",
			parentModel: "deepseek-v4-flash",
			thinkingLevel: "xhigh",
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.eventType).toBe("path_redirected");
		expect(ev.extension).toBe("path-guard");
		expect(ev.agent).toBe("pi");
		expect(ev.sessionId).toBe("sess-1");
		expect(ev.workspace).toBe("/cwd");
		expect(ev.details.toolType).toBe("write");
		expect(ev.details.repo).toBe("dotpi");
		expect(ev.details.givenPath).toBe("/dotpi/foo.ts");
		expect(ev.details.rewrittenTo).toBe("/.pi/agent/foo.ts");
		expect(ev.details.parentModel).toBe("deepseek-v4-flash");
		expect(ev.details.thinkingLevel).toBe("xhigh");
		expect(ev.details.originalCmd).toBeUndefined();
		expect(ev.timestamp).toBe("2026-07-04T12:00:00.000Z");
		expect(ev.eventId).toBeDefined();
	});

	test("supports edit and bash toolType", () => {
		const dir = makeStatsDir("types");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.logRedirected({
			ts: "t1",
			toolType: "edit",
			repo: "dotagents",
			givenPath: "/a.ts",
			rewrittenTo: "/b.ts",
		});
		log.logRedirected({
			ts: "t2",
			toolType: "bash",
			repo: "dotpi",
			givenPath: "/dotpi/cmd",
			rewrittenTo: "new command",
			originalCmd: "old command",
		});

		const ev = readEvents(log.filePath);
		expect(ev[0].details.toolType).toBe("edit");
		expect(ev[1].details.toolType).toBe("bash");
		expect(ev[1].details.originalCmd).toBe("old command");
	});

	test("truncates originalCmd to 200 chars", () => {
		const dir = makeStatsDir("truncate");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.logRedirected({
			ts: "t1",
			toolType: "bash",
			repo: "dotpi",
			givenPath: "/x",
			rewrittenTo: "/y",
			originalCmd: "x".repeat(250),
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.details.originalCmd.length).toBe(201); // 200 + "…"
		expect(ev.details.originalCmd.endsWith("…")).toBe(true);
	});
});

// ── 3. Multiple events ──────────────────────────────────────────────────

describe("event accumulation", () => {
	test("appends events in order", () => {
		const dir = makeStatsDir("multi");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.logRedirected({
			ts: "t1",
			toolType: "write",
			repo: "dotpi",
			givenPath: "/a.ts",
			rewrittenTo: "/b.ts",
		});
		log.logRedirected({
			ts: "t2",
			toolType: "bash",
			repo: "dotagents",
			givenPath: "/c",
			rewrittenTo: "/d",
			originalCmd: "mv c d",
		});

		const ev = readEvents(log.filePath);
		expect(ev.length).toBe(2);
		expect(ev[0].details.toolType).toBe("write");
		expect(ev[1].details.toolType).toBe("bash");
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

		log.logRedirected({
			ts: "t1",
			toolType: "write",
			repo: "dotpi",
			givenPath: "/a",
			rewrittenTo: "/b",
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

		log.logRedirected({
			ts: "t1",
			toolType: "bash",
			repo: "dotpi",
			givenPath: "/a",
			rewrittenTo: "/b",
			originalCmd: "cmd",
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

		log.logRedirected({
			ts: "t1",
			toolType: "edit",
			repo: "dotpi",
			givenPath: "/a",
			rewrittenTo: "/b",
		});
		log.logRedirected({
			ts: "t2",
			toolType: "bash",
			repo: "dotagents",
			givenPath: "/c",
			rewrittenTo: "/d",
			originalCmd: "cmd",
		});

		const ev = readEvents(log.filePath);
		expect(ev.length).toBe(2);
		expect(ev[0].details.toolType).toBe("edit");
		expect(ev[1].details.toolType).toBe("bash");
	});
});
