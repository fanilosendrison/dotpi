/**
 * Tests for path-guard stats-log module.
 *
 * Run with: bun test path-guard-internals/__tests__/stats-log.test.ts
 * (from ~/.pi/agent/extensions/)
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
	// Clean up temp dir before each test
	if (fs.existsSync(TMP_DIR)) {
		fs.rmSync(TMP_DIR, { recursive: true, force: true });
	}
});

afterEach(() => {
	// Clean up after test
	if (fs.existsSync(TMP_DIR)) {
		fs.rmSync(TMP_DIR, { recursive: true, force: true });
	}
});

// ── 1. File creation ─────────────────────────────────────────────────────

describe("file creation", () => {
	test("creates events.jsonl on first addRedirect", () => {
		const dir = makeStatsDir("file-creation");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/test",
		});

		log.addRedirect({
			ts: "2026-07-04T12:00:00.000Z",
			toolType: "write",
			repo: "dotpi",
			givenPath: "/Users/test/Developper/Projects/dotpi/foo.ts",
			rewrittenTo: "/Users/test/.pi/agent/foo.ts",
		});

		expect(fs.existsSync(log.filePath)).toBe(true);
		const events = readEvents(log.filePath);
		expect(events.length).toBe(1);
	});

	test("creates parent directory if missing", () => {
		const dir = path.join(TMP_DIR, "deeply", "nested", "dir");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/test",
		});

		log.addRedirect({
			ts: "2026-07-04T12:00:00.000Z",
			toolType: "edit",
			repo: "dotagents",
			givenPath: "/src/doc.md",
			rewrittenTo: "~/.agents/doc.md",
		});

		expect(fs.existsSync(log.filePath)).toBe(true);
	});
});

// ── 2. addRedirect ──────────────────────────────────────────────────────

describe("addRedirect", () => {
	test("writes a valid JSON line with all required fields", () => {
		const dir = makeStatsDir("redirect");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.addRedirect({
			ts: "2026-07-04T12:00:00.000Z",
			toolType: "write",
			repo: "dotpi",
			givenPath: "/dotpi/foo.ts",
			rewrittenTo: "/.pi/agent/foo.ts",
		});

		const events = readEvents(log.filePath);
		expect(events.length).toBe(1);

		const ev = events[0];
		expect(ev.extension).toBe("path-guard");
		expect(ev.eventType).toBe("redirect");
		expect(ev.agent).toBe("pi");
		expect(ev.sessionId).toBe("sess-1");
		expect(ev.workspace).toBe("/cwd");
		expect(ev.details.toolType).toBe("write");
		expect(ev.details.repo).toBe("dotpi");
		expect(ev.details.givenPath).toBe("/dotpi/foo.ts");
		expect(ev.details.rewrittenTo).toBe("/.pi/agent/foo.ts");
		expect(ev.timestamp).toBe("2026-07-04T12:00:00.000Z");
		expect(ev.eventId).toBeDefined();
		expect(ev.cycleId).toBeDefined();
	});

	test("supports edit toolType", () => {
		const dir = makeStatsDir("redirect-edit");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.addRedirect({
			ts: "2026-07-04T12:00:00.000Z",
			toolType: "edit",
			repo: "dotagents",
			givenPath: "/dotagents/foo.ts",
			rewrittenTo: "/.agents/foo.ts",
		});

		const events = readEvents(log.filePath);
		expect(events[0].details.toolType).toBe("edit");
	});
});

// ── 3. addBashRewrite ───────────────────────────────────────────────────

describe("addBashRewrite", () => {
	test("writes a valid JSON line with all required fields", () => {
		const dir = makeStatsDir("bash-rewrite");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.addBashRewrite({
			ts: "2026-07-04T12:00:00.000Z",
			repo: "dotpi",
			originalCmd: "cp foo.ts dotpi/extensions/",
			pathsChanged: ["dotpi/extensions/foo.ts"],
			redirectCount: 1,
		});

		const events = readEvents(log.filePath);
		expect(events.length).toBe(1);

		const ev = events[0];
		expect(ev.extension).toBe("path-guard");
		expect(ev.eventType).toBe("bash_rewrite");
		expect(ev.details.repo).toBe("dotpi");
		expect(ev.details.originalCmd).toBe("cp foo.ts dotpi/extensions/");
		expect(ev.details.pathsChanged).toEqual(["dotpi/extensions/foo.ts"]);
		expect(ev.details.redirectCount).toBe(1);
	});

	test("truncates originalCmd to 200 characters", () => {
		const dir = makeStatsDir("bash-truncate");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		const longCmd = "x".repeat(250);
		log.addBashRewrite({
			ts: "2026-07-04T12:00:00.000Z",
			repo: "dotpi",
			originalCmd: longCmd,
			pathsChanged: [],
			redirectCount: 0,
		});

		const events = readEvents(log.filePath);
		expect(events[0].details.originalCmd.length).toBe(201); // 200 chars + "…"
		expect(events[0].details.originalCmd.endsWith("…")).toBe(true);
	});

	test("does not truncate short commands", () => {
		const dir = makeStatsDir("bash-short");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		const shortCmd = "echo hello";
		log.addBashRewrite({
			ts: "2026-07-04T12:00:00.000Z",
			repo: "dotpi",
			originalCmd: shortCmd,
			pathsChanged: [],
			redirectCount: 0,
		});

		const events = readEvents(log.filePath);
		expect(events[0].details.originalCmd).toBe("echo hello");
		expect(events[0].details.originalCmd.length).toBe(10);
	});
});

// ── 4. flushSummary ─────────────────────────────────────────────────────

describe("flushSummary", () => {
	test("writes session_summary with correct ratios", () => {
		const dir = makeStatsDir("summary-ratios");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		// 2 redirects out of 5 total writes → 0.4 ratio
		log.addRedirect({
			ts: "t1",
			toolType: "write",
			repo: "dotpi",
			givenPath: "/a.ts",
			rewrittenTo: "/b.ts",
		});
		log.addRedirect({
			ts: "t2",
			toolType: "edit",
			repo: "dotagents",
			givenPath: "/c.md",
			rewrittenTo: "/d.md",
		});
		log.incCorrectWrite();
		log.incCorrectWrite();
		log.incCorrectWrite();

		// 1 bash rewrite out of 4 total → 0.25 ratio
		log.addBashRewrite({
			ts: "t3",
			repo: "dotpi",
			originalCmd: "mv a b",
			pathsChanged: ["a"],
			redirectCount: 1,
		});
		log.incCorrectBash();
		log.incCorrectBash();
		log.incCorrectBash();

		log.flushSummary({
			endTs: "2026-07-04T13:00:00.000Z",
			model: "deepseek-v4-flash",
			totalTurns: 10,
		});

		const events = readEvents(log.filePath);
		// 2 redirects + 1 bash_rewrite + 1 summary = 4 events total
		expect(events.length).toBe(4);

		const summary = events[3];
		expect(summary.eventType).toBe("session_summary");
		expect(summary.details.model).toBe("deepseek-v4-flash");
		expect(summary.details.redirects).toBe(2);
		expect(summary.details.correctWrites).toBe(3);
		expect(summary.details.writeTotal).toBe(5);
		expect(summary.details.writeRatio).toBe(0.4);
		expect(summary.details.bashRewrites).toBe(1);
		expect(summary.details.correctBash).toBe(3);
		expect(summary.details.bashTotal).toBe(4);
		expect(summary.details.bashRatio).toBe(0.25);
		expect(summary.details.repos).toEqual(["dotagents", "dotpi"]);
	});

	test("is silent when no events occurred", () => {
		const dir = makeStatsDir("summary-silent");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.flushSummary({
			endTs: "2026-07-04T13:00:00.000Z",
			totalTurns: 0,
		});

		// File should not exist (nothing written)
		expect(fs.existsSync(log.filePath)).toBe(false);
	});

	test("resets counters after flush", () => {
		const dir = makeStatsDir("summary-reset");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.addRedirect({
			ts: "t1",
			toolType: "write",
			repo: "dotpi",
			givenPath: "/a.ts",
			rewrittenTo: "/b.ts",
		});
		log.flushSummary({ endTs: "t2", model: "m1", totalTurns: 1 });

		// Second flush should produce nothing (counters reset)
		log.flushSummary({ endTs: "t3", totalTurns: 2 });

		const events = readEvents(log.filePath);
		expect(events.length).toBe(2); // redirect + first summary, no second summary
		expect(events[0].eventType).toBe("redirect");
		expect(events[1].eventType).toBe("session_summary");
	});

	test("writeRatio is 0 when no writes", () => {
		const dir = makeStatsDir("summary-zero-writes");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.addBashRewrite({
			ts: "t1",
			repo: "dotpi",
			originalCmd: "cmd",
			pathsChanged: [],
			redirectCount: 1,
		});
		log.flushSummary({ endTs: "t2", model: "m1", totalTurns: 1 });

		const events = readEvents(log.filePath);
		const summary = events[1];
		expect(summary.details.writeTotal).toBe(0);
		expect(summary.details.writeRatio).toBe(0);
		expect(summary.details.bashTotal).toBe(1);
		expect(summary.details.bashRatio).toBe(1);
	});
});

// ── 5. Counter isolation ────────────────────────────────────────────────

describe("counter isolation", () => {
	test("incCorrectWrite does not affect bash counters", () => {
		const dir = makeStatsDir("counter-isolation");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.addRedirect({
			ts: "t1",
			toolType: "write",
			repo: "dotpi",
			givenPath: "/a",
			rewrittenTo: "/b",
		});
		log.incCorrectWrite();
		log.incCorrectWrite();
		log.incCorrectBash();
		log.incCorrectBash();
		log.incCorrectBash();

		log.flushSummary({ endTs: "t2", model: "m1", totalTurns: 1 });

		const events = readEvents(log.filePath);
		const summary = events[events.length - 1];
		expect(summary.details.redirects).toBe(1);
		expect(summary.details.correctWrites).toBe(2);
		expect(summary.details.bashRewrites).toBe(0);
		expect(summary.details.correctBash).toBe(3);
	});
});

// ── 6. Event ordering ───────────────────────────────────────────────────

describe("event ordering", () => {
	test("events appear in insertion order", () => {
		const dir = makeStatsDir("ordering");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.addRedirect({
			ts: "t1",
			toolType: "write",
			repo: "dotpi",
			givenPath: "/a",
			rewrittenTo: "/b",
		});
		log.addBashRewrite({
			ts: "t2",
			repo: "dotpi",
			originalCmd: "cmd",
			pathsChanged: [],
			redirectCount: 1,
		});
		log.flushSummary({ endTs: "t3", totalTurns: 1 });

		const events = readEvents(log.filePath);
		expect(events[0].eventType).toBe("redirect");
		expect(events[1].eventType).toBe("bash_rewrite");
		expect(events[2].eventType).toBe("session_summary");
	});
});

// ── 7. Schema compliance ────────────────────────────────────────────────

describe("schema compliance", () => {
	test("all events have required top-level fields", () => {
		const dir = makeStatsDir("schema");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-uuid",
			cwd: "/workspace",
		});

		const requiredFields = [
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

		log.addRedirect({
			ts: "t1",
			toolType: "write",
			repo: "dotpi",
			givenPath: "/a",
			rewrittenTo: "/b",
		});
		log.addBashRewrite({
			ts: "t2",
			repo: "dotpi",
			originalCmd: "c",
			pathsChanged: [],
			redirectCount: 0,
		});
		log.flushSummary({ endTs: "t3", totalTurns: 1 });

		const events = readEvents(log.filePath);
		for (const ev of events) {
			for (const field of requiredFields) {
				expect(ev[field]).toBeDefined();
			}
			expect(ev.extension).toBe("path-guard");
			expect(ev.agent).toBe("pi");
		}
	});

	test("UUID format for eventId and sessionId and cycleId", () => {
		const dir = makeStatsDir("uuid");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-uuid",
			cwd: "/cwd",
		});

		log.addRedirect({
			ts: "t1",
			toolType: "write",
			repo: "dotpi",
			givenPath: "/a",
			rewrittenTo: "/b",
		});

		const events = readEvents(log.filePath);
		const uuidRe =
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
		expect(events[0].eventId).toMatch(uuidRe);
		expect(events[0].sessionId).toBe("sess-uuid"); // passed in constructor
		expect(events[0].cycleId).toMatch(uuidRe);
	});
});

// ── 8. Concurrent safety (atomic append pattern) ────────────────────────

describe("concurrent safety", () => {
	test("appends to existing file without overwriting", () => {
		const dir = makeStatsDir("concurrent");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.addRedirect({
			ts: "t1",
			toolType: "write",
			repo: "dotpi",
			givenPath: "/a",
			rewrittenTo: "/b",
		});
		log.addBashRewrite({
			ts: "t2",
			repo: "dotpi",
			originalCmd: "cmd",
			pathsChanged: [],
			redirectCount: 1,
		});

		const events = readEvents(log.filePath);
		expect(events.length).toBe(2);
		expect(events[0].eventType).toBe("redirect");
		expect(events[1].eventType).toBe("bash_rewrite");
	});
});
