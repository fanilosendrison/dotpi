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
	test("creates events.jsonl on first logCommitAttempted", () => {
		const dir = makeStatsDir("file");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });
		log.logCommitAttempted({
			ts: "t1",
			rawCommand: "git commit -m 'feat: x'",
			detectedBy: "git-commit",
			toolCallId: "tcid1",
		});
		expect(fs.existsSync(log.filePath)).toBe(true);
		expect(readEvents(log.filePath).length).toBe(1);
	});

	test("creates parent directory if missing", () => {
		const dir = path.join(TMP_DIR, "a", "b");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });
		log.addSkillInvoke({
			ts: "t1",
			parentModel: "m1",
			skillModel: "m2",
			skillProvider: "p1",
		});
		expect(fs.existsSync(log.filePath)).toBe(true);
	});
});

// ── 2. logCommitAttempted ───────────────────────────────────────────────

describe("logCommitAttempted", () => {
	test("writes valid JSON with all fields", () => {
		const dir = makeStatsDir("attempt");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.logCommitAttempted({
			ts: "2026-07-04T12:00:00.000Z",
			rawCommand: "git commit -m 'feat(api): add x' && git push",
			detectedBy: "git-commit",
			toolCallId: "tcid-abc",
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.extension).toBe("git-commits-push-enforcer");
		expect(ev.eventType).toBe("commit_attempted");
		expect(ev.agent).toBe("pi");
		expect(ev.sessionId).toBe("s1");
		expect(ev.workspace).toBe("/cwd");
		expect(ev.details.rawCommand).toBe(
			"git commit -m 'feat(api): add x' && git push",
		);
		expect(ev.details.detectedBy).toBe("git-commit");
		expect(ev.details.toolCallId).toBe("tcid-abc");
		expect(ev.timestamp).toBe("2026-07-04T12:00:00.000Z");
		expect(ev.eventId).toBeDefined();
	});

	test("detectedBy can be git-commits-push", () => {
		const dir = makeStatsDir("detect");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.logCommitAttempted({
			ts: "t1",
			rawCommand: "/git-commits-push",
			detectedBy: "git-commits-push",
			toolCallId: "tcid-2",
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.details.detectedBy).toBe("git-commits-push");
	});
});

// ── 3. addSkillInvoke ───────────────────────────────────────────────────

describe("addSkillInvoke", () => {
	test("writes valid JSON with model info", () => {
		const dir = makeStatsDir("skill");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.addSkillInvoke({
			ts: "2026-07-04T12:00:00.000Z",
			parentModel: "deepseek-v4-pro",
			skillModel: "deepseek-v4-flash",
			skillProvider: "deepseek",
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.eventType).toBe("skill_invoke");
		expect(ev.details.parentModel).toBe("deepseek-v4-pro");
		expect(ev.details.skillModel).toBe("deepseek-v4-flash");
		expect(ev.details.skillProvider).toBe("deepseek");
	});
});

// ── 4. Multiple events ──────────────────────────────────────────────────

describe("event accumulation", () => {
	test("appends events in order", () => {
		const dir = makeStatsDir("multi");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.logCommitAttempted({
			ts: "t1",
			rawCommand: "git commit -m 'feat: x'",
			detectedBy: "git-commit",
			toolCallId: "tc1",
		});
		log.addSkillInvoke({
			ts: "t2",
			parentModel: "m1",
			skillModel: "m2",
			skillProvider: "p1",
		});

		const ev = readEvents(log.filePath);
		expect(ev.length).toBe(2);
		expect(ev[0].eventType).toBe("commit_attempted");
		expect(ev[1].eventType).toBe("skill_invoke");
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

		log.logCommitAttempted({
			ts: "t1",
			rawCommand: "git commit -m 'x'",
			detectedBy: "git-commit",
			toolCallId: "tc1",
		});
		log.addSkillInvoke({
			ts: "t2",
			parentModel: "m1",
			skillModel: "m2",
			skillProvider: "p1",
		});

		for (const ev of readEvents(log.filePath)) {
			for (const f of required) expect(ev[f]).toBeDefined();
			expect(ev.extension).toBe("git-commits-push-enforcer");
			expect(ev.agent).toBe("pi");
		}
	});

	test("no cycleId field present", () => {
		const dir = makeStatsDir("nocycle");
		const log = createStatsLog({ statsDir: dir, sessionId: "s1", cwd: "/cwd" });

		log.logCommitAttempted({
			ts: "t1",
			rawCommand: "git commit -m 'x'",
			detectedBy: "git-commit",
			toolCallId: "tc1",
		});

		const ev = readEvents(log.filePath)[0];
		expect(ev.cycleId).toBeUndefined();
	});
});
