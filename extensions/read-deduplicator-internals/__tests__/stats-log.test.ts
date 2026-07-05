import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { createStatsLog } from "../stats-log";

let tmpDir: string;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stats-log-test-"));
});

afterEach(() => {
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeLog(): ReturnType<typeof createStatsLog> {
	return createStatsLog({
		statsDir: path.join(tmpDir, "stats"),
		cwd: "/Users/foo/dotpi",
	});
}

function readEvents(log: ReturnType<typeof createBlockedLog>): any[] {
	if (!fs.existsSync(log.filePath)) return [];
	return fs
		.readFileSync(log.filePath, "utf-8")
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l));
}

const BASE = {
	ts: "2026-07-03T12:00:00Z",
	path: "/a.ts",
	sizeBytes: 100,
	turnIndex: 1,
	parentModel: "deepseek-v4-flash",
	thinkingLevel: "xhigh",
	sessionId: "sess-1",
	workspace: "/w",
};

// ── 1. File creation ─────────────────────────────────────────────────────

describe("file creation", () => {
	test("creates events.jsonl on first logFileAccess", () => {
		const log = makeLog();
		log.logFileAccess({ ...BASE, action: "read" });
		expect(fs.existsSync(log.filePath)).toBe(true);
		expect(readEvents(log).length).toBe(1);
	});

	test("creates parent directory if missing", () => {
		const log = createStatsLog({
			statsDir: path.join(tmpDir, "a", "b"),
			cwd: "/w",
		});
		log.logFileAccess({ ...BASE, action: "read" });
		expect(fs.existsSync(log.filePath)).toBe(true);
	});
});

// ── 2. logFileAccess with different actions ─────────────────────────────

describe("logFileAccess (blocked)", () => {
	test("writes file_access with action blocked and blockedReason", () => {
		const log = makeLog();
		log.logFileAccess({
			...BASE,
			action: "blocked",
			blockedReason: "already in context (turn 1)",
		});

		const ev = readEvents(log)[0];
		expect(ev.details.action).toBe("blocked");
		expect(ev.details.blockedReason).toBe("already in context (turn 1)");
	});
});

describe("logFileAccess (read)", () => {
	test("writes file_access with action read, no blockedReason", () => {
		const log = makeLog();
		log.logFileAccess({ ...BASE, action: "read" });

		const ev = readEvents(log)[0];
		expect(ev.details.action).toBe("read");
		expect(ev.details.blockedReason).toBeUndefined();
	});
});

// ── 3. Multiple events ──────────────────────────────────────────────────

describe("event accumulation", () => {
	test("appends blocked and read in order", () => {
		const log = makeLog();
		log.logFileAccess({
			...BASE,
			action: "blocked",
			path: "/b.ts",
			blockedReason: "dup",
		});
		log.logFileAccess({ ...BASE, action: "read", path: "/c.ts" });

		const ev = readEvents(log);
		expect(ev.length).toBe(2);
		expect(ev[0].details.action).toBe("blocked");
		expect(ev[1].details.action).toBe("read");
	});
});

// ── 4. Schema compliance ────────────────────────────────────────────────

describe("schema compliance", () => {
	test("all events have required fields", () => {
		const log = makeLog();

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

		log.logFileAccess({ ...BASE, action: "blocked", blockedReason: "r" });
		log.logFileAccess({ ...BASE, action: "read" });

		for (const ev of readEvents(log)) {
			for (const f of required) expect(ev[f]).toBeDefined();
			expect(ev.extension).toBe("read-deduplicator");
			expect(ev.agent).toBe("pi");
		}
	});

	test("no cycleId field present", () => {
		const log = makeLog();
		log.logFileAccess({ ...BASE, action: "attempted" });
		expect(readEvents(log)[0].cycleId).toBeUndefined();
	});
});

// ── 5. Edge cases ───────────────────────────────────────────────────────

describe("edge cases", () => {
	test("handles multiple sessions with different paths", () => {
		const log = makeLog();
		log.logFileAccess({
			...BASE,
			action: "blocked",
			path: "/x.ts",
			blockedReason: "r",
		});
		log.logFileAccess({ ...BASE, action: "read", path: "/y.ts" });

		const ev = readEvents(log);
		expect(ev.length).toBe(2);
		expect(ev[0].details.path).toBe("/x.ts");
		expect(ev[0].details.action).toBe("blocked");
		expect(ev[1].details.path).toBe("/y.ts");
	});
});
