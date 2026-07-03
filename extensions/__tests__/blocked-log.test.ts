import { describe, expect, test, beforeEach, afterEach, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

import {
  createBlockedLog,
  type BlockedLogAPI,
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

function makeLog(opts: { cwd?: string; dryRun?: boolean; pathFilterContent?: string; } = {}): BlockedLogAPI {
  const statsDir = path.join(tmpDir, "stats", "read-deduplicator");
  if (opts.pathFilterContent !== undefined) {
    fs.mkdirSync(statsDir, { recursive: true });
    fs.writeFileSync(path.join(statsDir, ".pathfilter"), opts.pathFilterContent);
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
  return content.trim().split("\n").filter(Boolean).map(l => JSON.parse(l));
}

describe("BlockedLog JSONL", () => {
  test("writes block event as JSON", () => {
    const log = makeLog();
    log.startSession();
    log.addBlock({ ts: "2026-07-03T12:00:00Z", path: "/a.ts", sizeBytes: 100, turnIndex: 1 });
    
    const events = readLogEvents(log);
    expect(events.length).toBe(1);
    expect(events[0].eventType).toBe("block");
    expect(events[0].details.path).toBe("/a.ts");
    expect(events[0].details.sizeBytes).toBe(100);
    expect(events[0].details.turnIndex).toBe(1);
    expect(events[0].agent).toBe("pi");
  });

  test("writes cycle_summary event on endCycle", () => {
    const log = makeLog();
    log.startSession();
    log.addBlock({ ts: "2026-07-03T12:00:00Z", path: "/b.ts", sizeBytes: 200, turnIndex: 1 });
    log.endCycle({ startTs: "start", endTs: "end", readsAttempted: 5, totalTurns: 2 });
    
    const events = readLogEvents(log);
    expect(events.length).toBe(2);
    expect(events[1].eventType).toBe("cycle_summary");
    expect(events[1].details.readsAttempted).toBe(5);
    expect(events[1].details.blockedCount).toBe(1);
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
    const res = log.addBlock({ ts: "ts", path: "/secret/d.ts", sizeBytes: 10, turnIndex: 1 });
    expect(res.blocked).toBe(true);
    expect(res.logged).toBe(false);
    expect(readLogEvents(log).length).toBe(0);
  });

  test("dryRun does not write to file but returns blocked:false", () => {
    const log = makeLog({ dryRun: true });
    log.startSession();
    const res = log.addBlock({ ts: "ts", path: "/e.ts", sizeBytes: 10, turnIndex: 1 });
    expect(res.blocked).toBe(false);
    expect(res.logged).toBe(true);
    expect(readLogEvents(log).length).toBe(0);
  });
});
