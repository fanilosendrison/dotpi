import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createStatsLog } from "../stats-log";

const TMP_DIR = path.join(os.tmpdir(), "ztf-stats-test-" + Date.now());

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
	test("creates events.jsonl on first logTimeoutStripped", () => {
		const dir = makeStatsDir("file");
		const log = createStatsLog({ statsDir: dir });
		log.logTimeoutStripped({
			ts: "t1",
			originalTimeout: 60,
			parentModel: "m1",
			thinkingLevel: "xhigh",
			sessionId: "s1",
			workspace: "/cwd",
			toolCallId: "tc1",
		});
		expect(fs.existsSync(path.join(dir, "events.jsonl"))).toBe(true);
		expect(readEvents(path.join(dir, "events.jsonl")).length).toBe(1);
	});

	test("creates parent directory if missing", () => {
		const dir = path.join(TMP_DIR, "a", "b");
		const log = createStatsLog({ statsDir: dir });
		log.logTimeoutStripped({
			ts: "t1",
			originalTimeout: 30,
			parentModel: "m1",
			thinkingLevel: "low",
			sessionId: "s1",
			workspace: "/cwd",
			toolCallId: "tc1",
		});
		expect(fs.existsSync(path.join(dir, "events.jsonl"))).toBe(true);
	});
});

// ── 2. logTimeoutStripped ────────────────────────────────────────────────

describe("logTimeoutStripped", () => {
	test("writes valid JSON with all fields", () => {
		const dir = makeStatsDir("stripped");
		const log = createStatsLog({ statsDir: dir });
		log.logTimeoutStripped({
			ts: "2026-07-05T12:00:00.000Z",
			originalTimeout: 60,
			parentModel: "deepseek-v4-pro",
			thinkingLevel: "xhigh",
			sessionId: "suuid",
			workspace: "/w",
		});

		const ev = readEvents(path.join(dir, "events.jsonl"))[0];
		expect(ev.extension).toBe("zero-timeout-filter");
		expect(ev.eventType).toBe("timeout_stripped");
		expect(ev.agent).toBe("pi");
		expect(ev.sessionId).toBe("suuid");
		expect(ev.workspace).toBe("/w");
		expect(ev.details.originalTimeout).toBe(60);
		expect(ev.details.parentModel).toBe("deepseek-v4-pro");
		expect(ev.details.thinkingLevel).toBe("xhigh");
		expect(ev.timestamp).toBe("2026-07-05T12:00:00.000Z");
		expect(ev.eventId).toBeDefined();
	});
});

// ── 3. Multiple events ───────────────────────────────────────────────────

describe("event accumulation", () => {
	test("appends events in order", () => {
		const dir = makeStatsDir("multi");
		const log = createStatsLog({ statsDir: dir });
		log.logTimeoutStripped({
			ts: "t1",
			originalTimeout: 30,
			parentModel: "m1",
			thinkingLevel: "low",
			sessionId: "s1",
			workspace: "/w",
			toolCallId: "tc1",
		});
		log.logTimeoutStripped({
			ts: "t2",
			originalTimeout: 60,
			parentModel: "m2",
			thinkingLevel: "xhigh",
			sessionId: "s2",
			workspace: "/w2",
			toolCallId: "tc2",
		});

		const ev = readEvents(path.join(dir, "events.jsonl"));
		expect(ev.length).toBe(2);
		expect(ev[0].details.originalTimeout).toBe(30);
		expect(ev[1].details.originalTimeout).toBe(60);
	});
});

// ── 4. Schema compliance ─────────────────────────────────────────────────

describe("schema compliance", () => {
	test("all events have required fields", () => {
		const dir = makeStatsDir("schema");
		const log = createStatsLog({ statsDir: dir });

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

		log.logTimeoutStripped({
			ts: "t1",
			originalTimeout: 10,
			parentModel: "m1",
			thinkingLevel: "low",
			sessionId: "s1",
			workspace: "/w",
			toolCallId: "tc1",
		});

		for (const ev of readEvents(path.join(dir, "events.jsonl"))) {
			for (const f of required) expect(ev[f]).toBeDefined();
			expect(ev.extension).toBe("zero-timeout-filter");
			expect(ev.agent).toBe("pi");
		}
	});
});
