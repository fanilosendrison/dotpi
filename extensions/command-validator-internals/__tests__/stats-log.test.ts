/**
 * Tests for command-validator stats-log module.
 *
 * Run with: bun test command-validator-internals/__tests__/stats-log.test.ts
 * (from ~/.pi/agent/extensions/)
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createStatsLog } from "../stats-log";

const TMP_DIR = path.join(os.tmpdir(), "cmd-val-test-" + Date.now());

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
	if (fs.existsSync(TMP_DIR)) {
		fs.rmSync(TMP_DIR, { recursive: true, force: true });
	}
});

afterEach(() => {
	if (fs.existsSync(TMP_DIR)) {
		fs.rmSync(TMP_DIR, { recursive: true, force: true });
	}
});

// ── 1. File creation ─────────────────────────────────────────────────────

describe("file creation", () => {
	test("creates events.jsonl on first addDeny", () => {
		const dir = makeStatsDir("file-creation");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/test",
		});

		log.addDeny({
			ts: "2026-07-04T12:00:00.000Z",
			severity: "CRITICAL",
			violations: ["rm -rf is forbidden"],
			command: "rm -rf /foo",
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

		log.addDeny({
			ts: "2026-07-04T12:00:00.000Z",
			severity: "HIGH",
			violations: ["test"],
			command: "some command",
		});

		expect(fs.existsSync(log.filePath)).toBe(true);
	});
});

// ── 2. addDeny ───────────────────────────────────────────────────────────

describe("addDeny", () => {
	test("writes a valid JSON line with all required fields", () => {
		const dir = makeStatsDir("deny");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.addDeny({
			ts: "2026-07-04T12:00:00.000Z",
			severity: "CRITICAL",
			violations: ["rm -rf is forbidden", "Destructive pattern"],
			command: "rm -rf /some/dir",
		});

		const events = readEvents(log.filePath);
		expect(events.length).toBe(1);

		const ev = events[0];
		expect(ev.extension).toBe("command-validator");
		expect(ev.eventType).toBe("deny");
		expect(ev.agent).toBe("pi");
		expect(ev.sessionId).toBe("sess-1");
		expect(ev.workspace).toBe("/cwd");
		expect(ev.details.severity).toBe("CRITICAL");
		expect(ev.details.violations).toEqual([
			"rm -rf is forbidden",
			"Destructive pattern",
		]);
		expect(ev.details.command).toBe("rm -rf /some/dir");
		expect(ev.timestamp).toBe("2026-07-04T12:00:00.000Z");
		expect(ev.eventId).toBeDefined();
		expect(ev.cycleId).toBeDefined();
	});

	test("truncates command to 200 characters", () => {
		const dir = makeStatsDir("deny-truncate");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		const longCmd = "x".repeat(250);
		log.addDeny({
			ts: "t1",
			severity: "LOW",
			violations: [],
			command: longCmd,
		});

		const events = readEvents(log.filePath);
		expect(events[0].details.command.length).toBe(201);
		expect(events[0].details.command.endsWith("…")).toBe(true);
	});
});

// ── 3. addAskConfirm ─────────────────────────────────────────────────────

describe("addAskConfirm", () => {
	test("writes a valid JSON line with outcome allowed", () => {
		const dir = makeStatsDir("ask-ok");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.addAskConfirm({
			ts: "2026-07-04T12:00:00.000Z",
			tool: "sudo",
			severity: "HIGH",
			outcome: "allowed",
			command: "sudo apt update",
		});

		const events = readEvents(log.filePath);
		const ev = events[0];
		expect(ev.eventType).toBe("ask_confirm");
		expect(ev.details.tool).toBe("sudo");
		expect(ev.details.outcome).toBe("allowed");
		expect(ev.details.command).toBe("sudo apt update");
	});

	test("writes a valid JSON line with outcome denied", () => {
		const dir = makeStatsDir("ask-deny");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.addAskConfirm({
			ts: "2026-07-04T12:00:00.000Z",
			tool: "chmod",
			severity: "HIGH",
			outcome: "denied",
			command: "chmod 777 /etc/passwd",
		});

		const events = readEvents(log.filePath);
		expect(events[0].details.outcome).toBe("denied");
		expect(events[0].details.tool).toBe("chmod");
	});
});

// ── 4. incTotal ─────────────────────────────────────────────────────────

describe("incTotal", () => {
	test("affects denyRate in session_summary", () => {
		const dir = makeStatsDir("total");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		// 42 total commands, 3 denied
		for (let i = 0; i < 42; i++) log.incTotal();
		log.addDeny({
			ts: "t1",
			severity: "CRITICAL",
			violations: ["v1"],
			command: "c1",
		});
		log.addDeny({
			ts: "t2",
			severity: "HIGH",
			violations: ["v2"],
			command: "c2",
		});
		log.addDeny({
			ts: "t3",
			severity: "CRITICAL",
			violations: ["v3"],
			command: "c3",
		});

		log.flushSummary({ endTs: "t4", model: "m1", totalTurns: 1 });

		const events = readEvents(log.filePath);
		const summary = events[events.length - 1];
		expect(summary.details.totalCommands).toBe(42);
		expect(summary.details.denied).toBe(3);
		expect(summary.details.denyRate).toBeCloseTo(0.071, 2);
	});
});

// ── 5. flushSummary ─────────────────────────────────────────────────────

describe("flushSummary", () => {
	test("writes session_summary with correct ratios", () => {
		const dir = makeStatsDir("summary");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.incTotal(); // 1
		log.incTotal(); // 2
		log.incTotal(); // 3
		log.addDeny({
			ts: "t1",
			severity: "CRITICAL",
			violations: ["v"],
			command: "c",
		}); // 1 denied
		log.incTotal(); // 4
		log.incTotal(); // 5
		log.addAskConfirm({
			ts: "t2",
			tool: "sudo",
			severity: "HIGH",
			outcome: "allowed",
			command: "s",
		});
		log.incTotal(); // 6
		log.addAskConfirm({
			ts: "t3",
			tool: "kill",
			severity: "HIGH",
			outcome: "denied",
			command: "k",
		});
		log.incTotal(); // 7
		log.incTotal(); // 8

		log.flushSummary({
			endTs: "t4",
			model: "deepseek-v4-flash",
			totalTurns: 10,
		});

		const events = readEvents(log.filePath);
		// 1 deny + 2 ask_confirm + 1 summary = 4 events
		expect(events.length).toBe(4);

		const summary = events[3];
		expect(summary.eventType).toBe("session_summary");
		expect(summary.details.model).toBe("deepseek-v4-flash");
		expect(summary.details.totalCommands).toBe(8);
		expect(summary.details.denied).toBe(1);
		expect(summary.details.asked).toBe(2);
		expect(summary.details.userDenied).toBe(1);
		expect(summary.details.userAllowed).toBe(1);
		expect(summary.details.denyRate).toBeCloseTo(0.13, 2);
		expect(summary.details.confirmRate).toBe(0.5);
	});

	test("is silent when no events occurred", () => {
		const dir = makeStatsDir("silent");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.flushSummary({ endTs: "t1", totalTurns: 0 });

		expect(fs.existsSync(log.filePath)).toBe(false);
	});

	test("resets counters after flush", () => {
		const dir = makeStatsDir("reset");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.incTotal();
		log.addDeny({
			ts: "t1",
			severity: "CRITICAL",
			violations: ["v"],
			command: "c",
		});
		log.flushSummary({ endTs: "t2", model: "m1", totalTurns: 1 });

		// Second flush should produce nothing
		log.flushSummary({ endTs: "t3", totalTurns: 2 });

		const events = readEvents(log.filePath);
		expect(events.length).toBe(2); // deny + first summary
		expect(events[0].eventType).toBe("deny");
		expect(events[1].eventType).toBe("session_summary");
	});

	test("denyRate is 0 when no commands", () => {
		const dir = makeStatsDir("zero-cmds");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-1",
			cwd: "/cwd",
		});

		log.flushSummary({ endTs: "t1", model: "m1", totalTurns: 0 });

		expect(fs.existsSync(log.filePath)).toBe(false);
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

		log.addDeny({
			ts: "t1",
			severity: "CRITICAL",
			violations: ["v"],
			command: "c",
		});
		log.addAskConfirm({
			ts: "t2",
			tool: "sudo",
			severity: "HIGH",
			outcome: "denied",
			command: "s",
		});
		log.flushSummary({ endTs: "t3", totalTurns: 1 });

		const events = readEvents(log.filePath);
		expect(events[0].eventType).toBe("deny");
		expect(events[1].eventType).toBe("ask_confirm");
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

		log.addDeny({ ts: "t1", severity: "LOW", violations: [], command: "c" });
		log.addAskConfirm({
			ts: "t2",
			tool: "sudo",
			severity: "HIGH",
			outcome: "allowed",
			command: "s",
		});
		log.flushSummary({ endTs: "t3", totalTurns: 1 });

		const events = readEvents(log.filePath);
		for (const ev of events) {
			for (const field of requiredFields) {
				expect(ev[field]).toBeDefined();
			}
			expect(ev.extension).toBe("command-validator");
			expect(ev.agent).toBe("pi");
		}
	});

	test("UUID format for eventId and cycleId", () => {
		const dir = makeStatsDir("uuid");
		const log = createStatsLog({
			statsDir: dir,
			sessionId: "sess-uuid",
			cwd: "/cwd",
		});

		log.addDeny({ ts: "t1", severity: "LOW", violations: [], command: "c" });

		const events = readEvents(log.filePath);
		const uuidRe =
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
		expect(events[0].eventId).toMatch(uuidRe);
		expect(events[0].cycleId).toMatch(uuidRe);
	});
});
