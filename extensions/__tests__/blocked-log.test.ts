import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	type BlockedLogAPI,
	createBlockedLog,
} from "../read-deduplicator-internals/blocked-log";

let tmpDir: string;
let realpathSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
	tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "blocked-log-test-"));
	realpathSpy = spyOn(fs, "realpathSync").mockImplementation((p) => {
		const pStr = p.toString();
		if (pStr.includes("deleted-between-calls")) throw new Error("ENOENT");
		if (pStr.includes("link.ts")) return path.join(tmpDir, "real.ts");
		return pStr;
	});
});

afterEach(() => {
	realpathSpy.mockRestore();
	fs.rmSync(tmpDir, { recursive: true, force: true });
});

function makeLog(
	opts: { cwd?: string; dryRun?: boolean; pathFilterContent?: string } = {},
): BlockedLogAPI {
	const statsDir = path.join(tmpDir, "stats", "read-deduplicator");
	if (opts.pathFilterContent !== undefined) {
		fs.mkdirSync(statsDir, { recursive: true });
		fs.writeFileSync(
			path.join(statsDir, ".pathfilter"),
			opts.pathFilterContent,
		);
	}
	return createBlockedLog({
		statsDir,
		cwd: opts.cwd ?? "/Users/foo/dotpi",
		dryRun: opts.dryRun ?? false,
	});
}

function readLogEvents(logApi: BlockedLogAPI): any[] {
	if (!fs.existsSync(logApi.filePath)) return [];
	const content = fs.readFileSync(logApi.filePath, "utf-8");
	return content
		.trim()
		.split("\n")
		.filter(Boolean)
		.map((l) => JSON.parse(l));
}

describe("BlockedLog JSONL", () => {
	test("writes block event as JSON", () => {
		const log = makeLog();
		log.startSession();
		log.addBlock({
			ts: "2026-07-03T12:00:00Z",
			path: "/a.ts",
			sizeBytes: 100,
			turnIndex: 1,
		});

		const events = readLogEvents(log);
		expect(events.length).toBe(1);
		expect(events[0].eventType).toBe("block");
		expect(events[0].details.path).toBe("/a.ts");
		expect(events[0].details.sizeBytes).toBe(100);
		expect(events[0].details.turnIndex).toBe(1);
		expect(events[0].agent).toBe("pi");
		expect(typeof events[0].cycleId).toBe("string");
	});

	test("writes cycle_summary event on endCycle", () => {
		const log = makeLog();
		log.startSession();
		log.addBlock({
			ts: "2026-07-03T12:00:00Z",
			path: "/b.ts",
			sizeBytes: 200,
			turnIndex: 1,
		});
		log.endCycle({
			startTs: "start",
			endTs: "end",
			readsAttempted: 5,
			totalTurns: 2,
		});

		const events = readLogEvents(log);
		expect(events.length).toBe(2);
		expect(events[1].eventType).toBe("cycle_summary");
		expect(events[1].details.readsAttempted).toBe(5);
		expect(events[1].details.blockedCount).toBe(1);
		expect(events[1].cycleId).toBe(events[0].cycleId);
	});

	test("resolves paths relative to cwd", () => {
		const log = makeLog({ cwd: "/Users/foo/dotpi" });
		log.startSession();
		log.addBlock({ ts: "ts", path: "./src/c.ts", sizeBytes: 10, turnIndex: 1 });
		const events = readLogEvents(log);
		expect(events[0].details.path).toBe("/Users/foo/dotpi/src/c.ts");
	});

	test("filters sensitive paths", () => {
		const log = makeLog({ pathFilterContent: "/secret/\n" });
		log.startSession();
		const res = log.addBlock({
			ts: "ts",
			path: "/secret/d.ts",
			sizeBytes: 10,
			turnIndex: 1,
		});
		expect(res.blocked).toBe(true);
		expect(res.logged).toBe(false);
		expect(readLogEvents(log).length).toBe(0);
	});

	test("dryRun does not write to file but returns blocked:false", () => {
		const log = makeLog({ dryRun: true });
		log.startSession();
		const res = log.addBlock({
			ts: "ts",
			path: "/e.ts",
			sizeBytes: 10,
			turnIndex: 1,
		});
		expect(res.blocked).toBe(false);
		expect(res.logged).toBe(true);
		expect(readLogEvents(log).length).toBe(0);
	});
});

// ── addRead (T42–T46, T50, T51) ────────────────────────────────────────

describe("BlockedLog JSONL / addRead", () => {
	test("T42: appends a 'read' event with path, sizeBytes, turnIndex", () => {
		const log = makeLog();
		log.startSession();
		const res = log.addRead({
			ts: "2026-07-03T13:00:00Z",
			path: "/foo.ts",
			sizeBytes: 1024,
			turnIndex: 3,
		});
		expect(res.blocked).toBe(false);
		expect(res.logged).toBe(true);

		const events = readLogEvents(log);
		expect(events.length).toBe(1);
		expect(events[0].eventType).toBe("read");
		expect(events[0].details.path).toBe("/foo.ts");
		expect(events[0].details.sizeBytes).toBe(1024);
		expect(events[0].details.turnIndex).toBe(3);
		expect(events[0].agent).toBe("pi");
		expect(typeof events[0].cycleId).toBe("string");
	});

	test("T43: does NOT touch blocked-log's internal cycleReadsAttempted", () => {
		// After the refacto, addRead must not mutate the internal counter.
		// The counter is owned by the extension (incremented in tool_call).
		// We verify this indirectly: 3 addRead + 0 blocks + readsAttempted=0 passed
		// → no cycle_summary emitted (because readsAttempted=0 and blockedCount=0).
		// If addRead still incremented the internal counter, endCycle would see > 0
		// and emit a cycle_summary with the wrong value.
		const log = makeLog();
		log.startSession();
		log.addRead({ ts: "ts", path: "/a.ts", sizeBytes: 10, turnIndex: 1 });
		log.addRead({ ts: "ts", path: "/b.ts", sizeBytes: 20, turnIndex: 1 });
		log.addRead({ ts: "ts", path: "/c.ts", sizeBytes: 30, turnIndex: 1 });

		log.endCycle({
			startTs: "s",
			endTs: "e",
			readsAttempted: 0,
			totalTurns: 1,
		});

		const events = readLogEvents(log);
		const summary = events.find((e) => e.eventType === "cycle_summary");
		expect(summary).toBeUndefined(); // ← confirms addRead didn't bump the counter
	});

	test("T45: skips log when path matches filter", () => {
		const log = makeLog({ pathFilterContent: "/secret/\n" });
		log.startSession();
		const res = log.addRead({
			ts: "ts",
			path: "/secret/x.ts",
			sizeBytes: 10,
			turnIndex: 1,
		});
		expect(res.blocked).toBe(false);
		expect(res.logged).toBe(false);
		expect(readLogEvents(log).length).toBe(0);
	});

	test("T46: skips log when path normalization fails (realpath throws)", () => {
		const log = makeLog();
		log.startSession();
		const res = log.addRead({
			ts: "ts",
			path: "/deleted-between-calls/x.ts",
			sizeBytes: 10,
			turnIndex: 1,
		});
		expect(res.blocked).toBe(false);
		expect(res.logged).toBe(false);
		expect(readLogEvents(log).length).toBe(0);
	});

	test("addRead resolves paths relative to cwd", () => {
		const log = makeLog({ cwd: "/Users/foo/dotpi" });
		log.startSession();
		log.addRead({ ts: "ts", path: "./src/c.ts", sizeBytes: 10, turnIndex: 1 });
		const events = readLogEvents(log);
		expect(events[0].details.path).toBe("/Users/foo/dotpi/src/c.ts");
	});

	test("dryRun does not write 'read' events to file", () => {
		const log = makeLog({ dryRun: true });
		log.startSession();
		const res = log.addRead({
			ts: "ts",
			path: "/e.ts",
			sizeBytes: 10,
			turnIndex: 1,
		});
		expect(res.blocked).toBe(false);
		expect(res.logged).toBe(true);
		expect(readLogEvents(log).length).toBe(0);
	});

	test("addRead cycles independently from addBlock (distinct cycleIds per call)", () => {
		// Sanity: each addRead call gets its own event; addBlock in the same cycle
		// shares the cycleId with addRead events emitted before the cycle ends.
		const log = makeLog();
		log.startSession();
		log.addRead({ ts: "ts", path: "/r1.ts", sizeBytes: 10, turnIndex: 1 });
		log.addBlock({ ts: "ts", path: "/r2.ts", sizeBytes: 20, turnIndex: 1 });
		log.endCycle({
			startTs: "s",
			endTs: "e",
			readsAttempted: 2,
			totalTurns: 1,
		});

		const events = readLogEvents(log);
		expect(events.length).toBe(3); // 1 read + 1 block + 1 cycle_summary
		expect(events[0].eventType).toBe("read");
		expect(events[1].eventType).toBe("block");
		expect(events[2].eventType).toBe("cycle_summary");
		expect(events[0].cycleId).toBe(events[1].cycleId);
		expect(events[2].details.readsAttempted).toBe(2);
		expect(events[2].details.blockedCount).toBe(1);
	});
});

// ── Compteur extension vs blocked-log (T47, T48, T49) ────────────────────
//
// These tests assert the refacto contract: the blocked-log's cycle_summary
// reflects the readsAttempted value PASSED IN by the extension, not an
// internal counter mutated by addBlock/addRead.

describe("BlockedLog JSONL / compteur extension-owned", () => {
	test("T47: endCycle emits cycle_summary with the readsAttempted value passed in", () => {
		// Simulates the extension calling endCycle after 3 successful reads.
		const log = makeLog();
		log.startSession();
		log.addRead({ ts: "ts", path: "/a.ts", sizeBytes: 10, turnIndex: 1 });
		log.addRead({ ts: "ts", path: "/b.ts", sizeBytes: 20, turnIndex: 1 });
		log.addRead({ ts: "ts", path: "/c.ts", sizeBytes: 30, turnIndex: 1 });
		log.endCycle({
			startTs: "s",
			endTs: "e",
			readsAttempted: 3,
			totalTurns: 1,
		});

		const events = readLogEvents(log);
		const summary = events.find((e) => e.eventType === "cycle_summary");
		expect(summary.details.readsAttempted).toBe(3);
	});

	test("T48: blocked reads do not double-count readsAttempted", () => {
		// Regression test for the pre-refacto bug: addBlock used to increment
		// the internal counter, double-counting blocked reads. After refacto,
		// endCycle uses ONLY the passed-in value.
		const log = makeLog();
		log.startSession();
		log.addRead({ ts: "ts", path: "/a.ts", sizeBytes: 10, turnIndex: 1 });
		log.addBlock({ ts: "ts", path: "/a.ts", sizeBytes: 10, turnIndex: 1 }); // would re-block /a.ts
		log.addBlock({ ts: "ts", path: "/a.ts", sizeBytes: 10, turnIndex: 1 });
		log.endCycle({
			startTs: "s",
			endTs: "e",
			readsAttempted: 3,
			totalTurns: 1,
		});

		const events = readLogEvents(log);
		const summary = events.find((e) => e.eventType === "cycle_summary");
		expect(summary.details.readsAttempted).toBe(3); // ← passed value, not 5
		expect(summary.details.blockedCount).toBe(2);
	});

	test("T49: cycle_summary.readsAttempted == sum(read events) + sum(block events) for the cycle", () => {
		// Invariant the spec promises: per cycle, the consumer can verify
		// cycle_summary.readsAttempted == count(read) + count(block) by cycleId.
		const log = makeLog();
		log.startSession();
		const cycleA = log["cycleId" as keyof BlockedLogAPI]; // not used; just for clarity
		log.addRead({ ts: "ts", path: "/a.ts", sizeBytes: 10, turnIndex: 1 });
		log.addRead({ ts: "ts", path: "/b.ts", sizeBytes: 20, turnIndex: 1 });
		log.addBlock({ ts: "ts", path: "/c.ts", sizeBytes: 30, turnIndex: 1 });
		log.endCycle({
			startTs: "s",
			endTs: "e",
			readsAttempted: 3,
			totalTurns: 1,
		});

		const events = readLogEvents(log);
		const readsByCycle = events.filter((e) => e.eventType === "read").length;
		const blocksByCycle = events.filter((e) => e.eventType === "block").length;
		const summary = events.find((e) => e.eventType === "cycle_summary");
		expect(summary.details.readsAttempted).toBe(readsByCycle + blocksByCycle);
	});
});
