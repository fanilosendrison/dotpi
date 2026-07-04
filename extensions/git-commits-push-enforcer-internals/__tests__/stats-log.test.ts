/**
 * Tests for git-commits-push-enforcer stats-log module.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createStatsLog } from "../stats-log";

const TMP_DIR = path.join(os.tmpdir(), "gcpe-test-" + Date.now());

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
	test("creates events.jsonl on first addBlockCC", () => {
		const dir = makeStatsDir("file");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });
		log.addBlockCC({ ts: "t1", message: "WIP" });
		expect(fs.existsSync(log.filePath)).toBe(true);
		expect(readEvents(log.filePath).length).toBe(1);
	});

	test("creates parent directory if missing", () => {
		const dir = path.join(TMP_DIR, "a", "b");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });
		log.addBlockCC({ ts: "t1", message: "WIP" });
		expect(fs.existsSync(log.filePath)).toBe(true);
	});
});

// ── 2. addBlockCC ────────────────────────────────────────────────────────

describe("addBlockCC", () => {
	test("writes valid JSON with all fields", () => {
		const dir = makeStatsDir("cc");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.addBlockCC({ ts: "2026-07-04T12:00:00.000Z", message: "WIP" });

		const ev = readEvents(log.filePath)[0];
		expect(ev.extension).toBe("git-commits-push-enforcer");
		expect(ev.eventType).toBe("block_cc");
		expect(ev.agent).toBe("pi");
		expect(ev.sessionId).toBe("s1");
		expect(ev.workspace).toBe("/cwd");
		expect(ev.details.message).toBe("WIP");
		expect(ev.timestamp).toBe("2026-07-04T12:00:00.000Z");
		expect(ev.eventId).toBeDefined();
		expect(ev.cycleId).toBeDefined();
	});
});

// ── 3. addBlockPush ──────────────────────────────────────────────────────

describe("addBlockPush", () => {
	test("writes valid JSON with all fields", () => {
		const dir = makeStatsDir("push");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.addBlockPush({ ts: "t1", message: "feat: add x" });

		const ev = readEvents(log.filePath)[0];
		expect(ev.eventType).toBe("block_push");
		expect(ev.details.message).toBe("feat: add x");
	});
});

// ── 4. session_summary ──────────────────────────────────────────────────

describe("session_summary", () => {
	test("writes correct blockRate", () => {
		const dir = makeStatsDir("summary");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		// Total: 3 blocked (2 cc + 1 push) + 1 allowedRaw + 1 skillInvoked = 5
		log.incTotal();
		log.addBlockCC({ ts: "t1", message: "WIP" });
		log.incTotal();
		log.addBlockCC({ ts: "t2", message: "fix" });
		log.incTotal();
		log.addBlockPush({ ts: "t3", message: "feat: ok" });
		log.incTotal();
		log.incAllowedRaw();
		log.incTotal();
		log.incSkillInvoked();

		log.flushSummary({
			endTs: "t4",
			model: "deepseek-v4-flash",
			totalTurns: 5,
		});

		const events = readEvents(log.filePath);
		expect(events.length).toBe(4); // 3 blocks + 1 summary

		const s = events[3];
		expect(s.eventType).toBe("session_summary");
		expect(s.details.model).toBe("deepseek-v4-flash");
		expect(s.details.totalCommits).toBe(5);
		expect(s.details.blockedCC).toBe(2);
		expect(s.details.blockedPush).toBe(1);
		expect(s.details.allowedRaw).toBe(1);
		expect(s.details.skillInvoked).toBe(1);
		expect(s.details.blockRate).toBeCloseTo(0.6, 1); // 3/5
	});

	test("is silent when no commits", () => {
		const dir = makeStatsDir("silent");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });
		log.flushSummary({ endTs: "t1", totalTurns: 0 });
		expect(fs.existsSync(log.filePath)).toBe(false);
	});

	test("resets counters after flush", () => {
		const dir = makeStatsDir("reset");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.incTotal();
		log.addBlockCC({ ts: "t1", message: "WIP" });
		log.flushSummary({ endTs: "t2", model: "m1", totalTurns: 1 });

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

		log.addBlockCC({ ts: "t1", message: "WIP" });
		log.addBlockPush({ ts: "t2", message: "fix" });
		log.flushSummary({ endTs: "t3", totalTurns: 1 });

		for (const ev of readEvents(log.filePath)) {
			for (const f of required) expect(ev[f]).toBeDefined();
			expect(ev.extension).toBe("git-commits-push-enforcer");
			expect(ev.agent).toBe("pi");
		}
	});
});
