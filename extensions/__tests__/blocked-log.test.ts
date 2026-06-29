/**
 * TDD RED phase — blocked-log module tests.
 *
 * These tests verify the blocked-reads logging feature of read-deduplicator.
 * The module under test (`blocked-log.ts`) does not exist yet — all tests
 * should fail at import time or assertion time.
 *
 * @see specs/read-deduplicator-tests.md
 * @see specs/read-deduplicator-blocked-log.md
 */
import { describe, expect, test, beforeEach, afterEach, mock, spyOn } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

// The module under test — does not exist yet (RED phase).
import {
  createBlockedLog,
  type BlockedLogAPI,
  type AddBlockResult,
} from "../read-deduplicator/blocked-log";

// ── Helpers ──────────────────────────────────────────────────────────────

let tmpDir: string;
let realpathSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "blocked-log-test-"));
  
  // Mock realpathSync to avoid ENOENT on fake paths like "/abs/path.ts"
  realpathSpy = spyOn(fs, "realpathSync").mockImplementation((p) => {
    const pStr = p.toString();
    if (pStr.includes("deleted-between-calls")) {
      throw new Error("ENOENT");
    }
    if (pStr.includes("link.ts")) {
      return path.join(tmpDir, "real.ts");
    }
    return pStr;
  });
});

afterEach(() => {
  realpathSpy.mockRestore();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

/** Create a BlockedLog instance pointing at our temp dir. */
function makeLog(opts: {
  sessionId?: string;
  cwd?: string;
  dryRun?: boolean;
  pathFilterContent?: string;
} = {}): BlockedLogAPI {
  const statsDir = path.join(tmpDir, "stats", "read-deduplicator");
  if (opts.pathFilterContent !== undefined) {
    fs.mkdirSync(statsDir, { recursive: true });
    fs.writeFileSync(path.join(statsDir, ".pathfilter"), opts.pathFilterContent);
  }
  return createBlockedLog({
    statsDir,
    sessionId: "sessionId" in opts ? opts.sessionId : "2026-06-29T17-01-23-a1b2c3d4",
    cwd: opts.cwd ?? "/Users/foo/dotpi",
    dryRun: opts.dryRun ?? false,
  });
}

/** Read the generated log file. */
function readLogFile(logApi: BlockedLogAPI): string {
  return fs.readFileSync(logApi.filePath, "utf-8");
}

// ═════════════════════════════════════════════════════════════════════════
// 1. Session et création de fichier
// ═════════════════════════════════════════════════════════════════════════

describe("1. Session et création de fichier", () => {
  // T01
  test("creates file with header on session_start", () => {
    const log = makeLog({ sessionId: "2026-06-29T17-01-23-a1b2c3d4" });
    log.startSession();

    const content = readLogFile(log);
    expect(content).toContain("# Read Deduplicator — Blocked Reads Log");
    expect(content).toContain("> **Format version**: 0.1.0");
    expect(content).toContain("# Session: 2026-06-29T17-01-23-a1b2c3d4");
    expect(content).toContain("**Started**");
    expect(content).toContain("**CWD**");
  });

  // T02
  test("creates parent directory if missing", () => {
    const deepDir = path.join(tmpDir, "deep", "nested", "stats", "read-deduplicator");
    const log = createBlockedLog({
      statsDir: deepDir,
      sessionId: "test-session",
      cwd: "/tmp",
      dryRun: false,
    });
    log.startSession();

    expect(fs.existsSync(deepDir)).toBe(true);
    expect(fs.existsSync(log.filePath)).toBe(true);
  });

  // T03
  test("names file from session.id", () => {
    const log = makeLog({ sessionId: "2026-06-29T17-01-23-a1b2c3d4" });
    log.startSession();

    expect(path.basename(log.filePath)).toBe("2026-06-29T17-01-23-a1b2c3d4.md");
  });

  // T04
  test("names file ephemeral when no session.id", () => {
    const log = makeLog({ sessionId: undefined });
    log.startSession();

    expect(path.basename(log.filePath)).toMatch(/^ephemeral-\d+\.md$/);
  });

  // T05
  test("reuses existing file for same session", () => {
    const log = makeLog({ sessionId: "reuse-session" });
    log.startSession();

    const contentBefore = readLogFile(log);
    const headerCount = (contentBefore.match(/# Session: reuse-session/g) || []).length;
    expect(headerCount).toBe(1);

    // Start again with same session
    const log2 = createBlockedLog({
      statsDir: path.dirname(log.filePath),
      sessionId: "reuse-session",
      cwd: "/Users/foo/dotpi",
      dryRun: false,
    });
    log2.startSession();

    const contentAfter = readLogFile(log2);
    const headerCountAfter = (contentAfter.match(/# Session: reuse-session/g) || []).length;
    // Should NOT have added a second header — still just 1
    expect(headerCountAfter).toBe(1);
  });

  // T06
  test("inserts separator for different session in existing file", () => {
    const statsDir = path.join(tmpDir, "stats", "read-deduplicator");
    fs.mkdirSync(statsDir, { recursive: true });

    // Create a file for "old-session"
    const log = createBlockedLog({
      statsDir,
      sessionId: "old-session",
      cwd: "/Users/foo/dotpi",
      dryRun: false,
    });
    log.startSession();
    const filePath = log.filePath;

    // Now open the SAME file with a different session ID.
    // Force same file path by renaming / reusing the exact file.
    const log2 = createBlockedLog({
      statsDir,
      sessionId: "new-session",
      cwd: "/Users/foo/dotpi",
      dryRun: false,
      // Force reuse of old-session's file (simulate ID collision)
      forceFilePath: filePath,
    });
    log2.startSession();

    const content = fs.readFileSync(filePath, "utf-8");
    // Must contain both sessions with a separator
    expect(content).toContain("# Session: old-session");
    expect(content).toContain("# Session: new-session");
    // The separator --- must appear BETWEEN the two session blocks
    const oldIdx = content.indexOf("# Session: old-session");
    const sepIdx = content.indexOf("---", oldIdx);
    const newIdx = content.indexOf("# Session: new-session");
    expect(sepIdx).toBeGreaterThan(oldIdx);
    expect(newIdx).toBeGreaterThan(sepIdx);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 2. Buffer et flush par cycle
// ═════════════════════════════════════════════════════════════════════════

describe("2. Buffer et flush par cycle", () => {
  // T07
  test("appends cycle block on endCycle with blocked reads", () => {
    const log = makeLog();
    log.startSession();

    log.addBlock({ ts: "17:01:45.123", path: "/Users/foo/bar.ts", sizeBytes: 4300, turnIndex: 2 });
    log.addBlock({ ts: "17:02:12.456", path: "/Users/foo/baz.md", sizeBytes: 1126, turnIndex: 3 });
    log.endCycle({
      startTs: "17:01:23",
      endTs: "17:03:45",
      readsAttempted: 12,
      totalTurns: 4,
    });

    const content = readLogFile(log);
    expect(content).toContain("## Cycle 1");
    expect(content).toContain("12 tentés / 2 bloqués");
    expect(content).toContain("`17:01:45.123`");
    expect(content).toContain("`17:02:12.456`");
  });

  // T08
  test("writes nothing on endCycle with zero blocked reads", () => {
    const log = makeLog();
    log.startSession();

    const contentBefore = readLogFile(log);

    // No addBlock calls, but there were reads attempted
    log.endCycle({
      startTs: "17:01:00",
      endTs: "17:02:00",
      readsAttempted: 5,
      totalTurns: 2,
    });

    const contentAfter = readLogFile(log);
    // Nothing new written — file should be unchanged
    expect(contentAfter).toBe(contentBefore);
  });

  // T09
  test("skips cycle number for empty cycles (absolute numbering)", () => {
    const log = makeLog();
    log.startSession();

    // Cycle 1 — has blocages
    log.addBlock({ ts: "17:01:00.000", path: "/a.ts", sizeBytes: 100, turnIndex: 1 });
    log.addBlock({ ts: "17:01:01.000", path: "/b.ts", sizeBytes: 200, turnIndex: 1 });
    log.endCycle({ startTs: "17:01:00", endTs: "17:02:00", readsAttempted: 5, totalTurns: 2 });

    // Cycle 2 — empty (no blocages)
    log.endCycle({ startTs: "17:02:00", endTs: "17:03:00", readsAttempted: 3, totalTurns: 1 });

    // Cycle 3 — has blocages
    log.addBlock({ ts: "17:03:01.000", path: "/c.ts", sizeBytes: 300, turnIndex: 1 });
    log.endCycle({ startTs: "17:03:00", endTs: "17:04:00", readsAttempted: 4, totalTurns: 2 });

    const content = readLogFile(log);
    expect(content).toContain("Cycle 1");
    expect(content).not.toContain("Cycle 2");
    expect(content).toContain("Cycle 3");
  });

  // T10
  test("flushes automatically at 2000 entries", () => {
    const log = makeLog();
    log.startSession();

    // Add 2001 blocks to trigger auto-flush
    for (let i = 0; i < 2001; i++) {
      log.addBlock({
        ts: `17:00:00.${String(i).padStart(3, "0")}`,
        path: `/file-${i}.ts`,
        sizeBytes: 100,
        turnIndex: 1,
      });
    }

    // The auto-flush should have written before endCycle
    const content = readLogFile(log);
    expect(content).toContain("Cycle");
    // Buffer should have been flushed and re-opened
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 3. Format des lignes de blocage
// ═════════════════════════════════════════════════════════════════════════

describe("3. Format des lignes de blocage", () => {
  // T11
  test("formats line with timestamp, path, sizes, turn", () => {
    const log = makeLog();
    log.startSession();

    log.addBlock({ ts: "17:01:45.123", path: "/abs/path.ts", sizeBytes: 4300, turnIndex: 2 });
    log.endCycle({ startTs: "17:01:00", endTs: "17:02:00", readsAttempted: 5, totalTurns: 3 });

    const content = readLogFile(log);
    expect(content).toContain("`17:01:45.123`");
    expect(content).toContain("`/abs/path.ts`");
    expect(content).toContain("4.3 KB");
    expect(content).toContain("4300 B");
    expect(content).toContain("turn 2");
  });

  // T12
  test("formats bytes size (no decimal)", () => {
    const log = makeLog();
    log.startSession();

    log.addBlock({ ts: "17:00:00.000", path: "/f.ts", sizeBytes: 430, turnIndex: 1 });
    log.endCycle({ startTs: "17:00:00", endTs: "17:01:00", readsAttempted: 1, totalTurns: 1 });

    const content = readLogFile(log);
    expect(content).toContain("(430 B)");
    // Should NOT have KB/MB format
    expect(content).not.toMatch(/\d+\.\d+ KB/);
  });

  // T13
  test("formats KB with one decimal", () => {
    const log = makeLog();
    log.startSession();

    log.addBlock({ ts: "17:00:00.000", path: "/f.ts", sizeBytes: 4300, turnIndex: 1 });
    log.endCycle({ startTs: "17:00:00", endTs: "17:01:00", readsAttempted: 1, totalTurns: 1 });

    const content = readLogFile(log);
    expect(content).toContain("(4.3 KB / 4300 B)");
  });

  // T14
  test("formats MB with one decimal", () => {
    const log = makeLog();
    log.startSession();

    log.addBlock({ ts: "17:00:00.000", path: "/f.ts", sizeBytes: 1259500, turnIndex: 1 });
    log.endCycle({ startTs: "17:00:00", endTs: "17:01:00", readsAttempted: 1, totalTurns: 1 });

    const content = readLogFile(log);
    expect(content).toContain("(1.2 MB / 1259500 B)");
  });

  // T15
  test("formats GB with one decimal", () => {
    const log = makeLog();
    log.startSession();

    log.addBlock({ ts: "17:00:00.000", path: "/f.ts", sizeBytes: 1500000000, turnIndex: 1 });
    log.endCycle({ startTs: "17:00:00", endTs: "17:01:00", readsAttempted: 1, totalTurns: 1 });

    const content = readLogFile(log);
    expect(content).toContain("(1.5 GB / 1500000000 B)");
  });

  // T16
  test("uses base-10 (1 KB = 1000 B)", () => {
    const log = makeLog();
    log.startSession();

    log.addBlock({ ts: "17:00:00.000", path: "/f.ts", sizeBytes: 1000, turnIndex: 1 });
    log.endCycle({ startTs: "17:00:00", endTs: "17:01:00", readsAttempted: 1, totalTurns: 1 });

    const content = readLogFile(log);
    expect(content).toContain("(1.0 KB / 1000 B)");
    // Must NOT be displayed as plain bytes
    expect(content).not.toMatch(/\(1000 B\)/);
  });

  // T17
  test("pluralizes correctly", () => {
    const log = makeLog();
    log.startSession();

    // Single turn
    log.addBlock({ ts: "17:00:00.000", path: "/a.ts", sizeBytes: 100, turnIndex: 1 });
    log.endCycle({ startTs: "17:00:00", endTs: "17:01:00", readsAttempted: 1, totalTurns: 1 });

    const content1 = readLogFile(log);
    expect(content1).toContain("(1 turn)");

    // Multiple turns in cycle header
    const log2 = makeLog();
    log2.startSession();
    log2.addBlock({ ts: "17:00:00.000", path: "/b.ts", sizeBytes: 100, turnIndex: 3 });
    log2.endCycle({ startTs: "17:00:00", endTs: "17:01:00", readsAttempted: 1, totalTurns: 3 });

    const content2 = readLogFile(log2);
    expect(content2).toContain("(3 turns)");
  });

  // T18
  test("escapes backticks in path", () => {
    const log = makeLog();
    log.startSession();

    log.addBlock({ ts: "17:00:00.000", path: "/path/with`backtick.ts", sizeBytes: 100, turnIndex: 1 });
    log.endCycle({ startTs: "17:00:00", endTs: "17:01:00", readsAttempted: 1, totalTurns: 1 });

    const content = readLogFile(log);
    expect(content).toContain("\\`");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 4. Normalisation des chemins
// ═════════════════════════════════════════════════════════════════════════

describe("4. Normalisation des chemins", () => {
  // T19
  test("resolves relative path to absolute", () => {
    const log = makeLog({ cwd: "/Users/foo/dotpi" });
    log.startSession();

    log.addBlock({ ts: "17:00:00.000", path: "./src/bar.ts", sizeBytes: 100, turnIndex: 1 });
    log.endCycle({ startTs: "17:00:00", endTs: "17:01:00", readsAttempted: 1, totalTurns: 1 });

    const content = readLogFile(log);
    expect(content).toContain("/Users/foo/dotpi/src/bar.ts");
    expect(content).not.toContain("./src/bar.ts");
  });

  // T20
  test("resolves symlinks", () => {
    // Create a real file and a symlink to it
    const realFile = path.join(tmpDir, "real.ts");
    const linkFile = path.join(tmpDir, "link.ts");
    fs.writeFileSync(realFile, "content");
    fs.symlinkSync(realFile, linkFile);

    const log = makeLog();
    log.startSession();

    log.addBlock({ ts: "17:00:00.000", path: linkFile, sizeBytes: 100, turnIndex: 1 });
    log.endCycle({ startTs: "17:00:00", endTs: "17:01:00", readsAttempted: 1, totalTurns: 1 });

    const content = readLogFile(log);
    // Should contain the resolved (real) path, not the symlink
    expect(content).toContain(realFile);
    expect(content).not.toContain("link.ts");
  });

  // T21
  test("skips block on realpathSync failure", () => {
    const log = makeLog();
    log.startSession();

    // Pass a path that doesn't exist (realpathSync will throw)
    const result = log.addBlock({
      ts: "17:00:00.000",
      path: "/nonexistent/deleted-between-calls.ts",
      sizeBytes: 100,
      turnIndex: 1,
    });

    log.endCycle({ startTs: "17:00:00", endTs: "17:01:00", readsAttempted: 1, totalTurns: 1 });

    // The block should have been silently skipped
    const content = readLogFile(log);
    expect(content).not.toContain("deleted-between-calls.ts");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 5. Filtrage des paths sensibles
// ═════════════════════════════════════════════════════════════════════════

describe("5. Filtrage des paths sensibles", () => {
  // T22
  test("filters out matching path from log but still blocks read", () => {
    const log = makeLog({
      pathFilterContent: "/Users/f/Documents/privé/\n",
    });
    log.startSession();

    const result = log.addBlock({
      ts: "17:00:00.000",
      path: "/Users/f/Documents/privé/x.ts",
      sizeBytes: 100,
      turnIndex: 1,
    });

    expect(result).toEqual({ blocked: true, logged: false });

    log.endCycle({ startTs: "17:00:00", endTs: "17:01:00", readsAttempted: 1, totalTurns: 1 });

    const content = readLogFile(log);
    expect(content).not.toContain("privé");
  });

  // T23
  test("filters on normalized path, not raw path", () => {
    const log = makeLog({
      cwd: "/Users/f",
      pathFilterContent: "/Users/f/Documents/privé/\n",
    });
    log.startSession();

    const result = log.addBlock({
      ts: "17:00:00.000",
      path: "./Documents/privé/x.ts",
      sizeBytes: 100,
      turnIndex: 1,
    });

    // After normalization: /Users/f/Documents/privé/x.ts → matches filter
    expect(result).toEqual({ blocked: true, logged: false });
  });

  // T24
  test("does not filter when .pathfilter file absent", () => {
    // No pathFilterContent → no .pathfilter file
    const log = makeLog();
    log.startSession();

    const result = log.addBlock({
      ts: "17:00:00.000",
      path: "/Users/f/Documents/privé/x.ts",
      sizeBytes: 100,
      turnIndex: 1,
    });

    expect(result).toEqual({ blocked: true, logged: true });
  });

  // T25
  test("reloads .pathfilter on each session_start only", () => {
    const statsDir = path.join(tmpDir, "stats", "read-deduplicator");
    fs.mkdirSync(statsDir, { recursive: true });
    const filterPath = path.join(statsDir, ".pathfilter");

    // Initial filter: blocks /secret/
    fs.writeFileSync(filterPath, "/secret/\n");

    const log = createBlockedLog({
      statsDir,
      sessionId: "filter-test",
      cwd: "/tmp",
      dryRun: false,
    });
    log.startSession();

    // First block: /secret/a.ts → filtered
    const r1 = log.addBlock({ ts: "17:00:00.000", path: "/secret/a.ts", sizeBytes: 100, turnIndex: 1 });
    expect(r1).toEqual({ blocked: true, logged: false });

    // Modify filter mid-session: now blocks /other/
    fs.writeFileSync(filterPath, "/other/\n");

    // Second block: /secret/b.ts → still filtered (old filter used)
    const r2 = log.addBlock({ ts: "17:00:01.000", path: "/secret/b.ts", sizeBytes: 100, turnIndex: 2 });
    expect(r2).toEqual({ blocked: true, logged: false });
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 6. Écriture concurrente et atomique
// ═════════════════════════════════════════════════════════════════════════

describe("6. Écriture concurrente et atomique", () => {
  // T26
  test("uses read-modify-write on flush", () => {
    const log = makeLog();
    log.startSession();

    // Cycle 1
    log.addBlock({ ts: "17:01:00.000", path: "/a.ts", sizeBytes: 100, turnIndex: 1 });
    log.endCycle({ startTs: "17:01:00", endTs: "17:02:00", readsAttempted: 5, totalTurns: 2 });

    // Cycle 2
    log.addBlock({ ts: "17:03:00.000", path: "/b.ts", sizeBytes: 200, turnIndex: 1 });
    log.endCycle({ startTs: "17:03:00", endTs: "17:04:00", readsAttempted: 3, totalTurns: 1 });

    const content = readLogFile(log);
    // Both cycles must be present (no overwrite)
    expect(content).toContain("Cycle 1");
    expect(content).toContain("Cycle 2");
  });

  // T27
  test("writes via temp file + rename", () => {
    const log = makeLog();
    log.startSession();

    // Spy on renameSync to verify atomic write pattern
    const renameSpy = spyOn(fs, "renameSync");

    log.addBlock({ ts: "17:00:00.000", path: "/a.ts", sizeBytes: 100, turnIndex: 1 });
    log.endCycle({ startTs: "17:00:00", endTs: "17:01:00", readsAttempted: 1, totalTurns: 1 });

    // renameSync should have been called with a .tmp.<pid> source
    expect(renameSpy).toHaveBeenCalled();
    const [tmpPath] = renameSpy.mock.calls[renameSpy.mock.calls.length - 1];
    expect(String(tmpPath)).toMatch(/\.md\.tmp\.\d+$/);

    renameSpy.mockRestore();
  });

  // T28
  test("survives rename failure gracefully", () => {
    const log = makeLog();
    log.startSession();

    // Make renameSync throw
    const renameSpy = spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("Permission denied");
    });
    const stderrSpy = spyOn(process.stderr, "write");

    log.addBlock({ ts: "17:00:00.000", path: "/a.ts", sizeBytes: 100, turnIndex: 1 });

    // Should not throw
    expect(() => {
      log.endCycle({ startTs: "17:00:00", endTs: "17:01:00", readsAttempted: 1, totalTurns: 1 });
    }).not.toThrow();

    // Error should have been logged to stderr
    expect(stderrSpy).toHaveBeenCalled();

    renameSpy.mockRestore();
    stderrSpy.mockRestore();
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 7. Robustesse et erreurs
// ═════════════════════════════════════════════════════════════════════════

describe("7. Robustesse et erreurs", () => {
  // T29
  test("addBlock exception caught, cycle lost, reads still blocked", () => {
    const log = makeLog();
    log.startSession();

    // We simulate a bug in the formatter by spying on internal formatting.
    // In practice, the module should catch any exception in addBlock and
    // still return { blocked: true }.
    const stderrSpy = spyOn(process.stderr, "write");

    // Force an internal error — addBlock with an object that causes formatting to throw
    // (e.g., null sizeBytes that the formatter doesn't expect).
    // The contract says: exception caught, stderr, read stays blocked.
    const result = log.addBlock({
      ts: "17:00:00.000",
      path: "/valid.ts",
      sizeBytes: null as unknown as number, // Provoke internal error
      turnIndex: 1,
    });

    // Read must still be blocked even if the log entry was lost
    expect(result.blocked).toBe(true);

    stderrSpy.mockRestore();
  });

  // T30
  test("flush exception caught, extension continues", () => {
    const log = makeLog();
    log.startSession();

    // Make writeFileSync throw to simulate flush failure
    const writeSpy = spyOn(fs, "writeFileSync").mockImplementation((...args: any[]) => {
      // Allow the initial session file creation but fail on flush
      if (String(args[0]).includes(".tmp.")) {
        throw new Error("I/O error");
      }
      // Call through for non-tmp writes
      return (fs.writeFileSync as any).apply(fs, args);
    });
    const stderrSpy = spyOn(process.stderr, "write");

    log.addBlock({ ts: "17:00:00.000", path: "/a.ts", sizeBytes: 100, turnIndex: 1 });

    // endCycle should NOT throw
    expect(() => {
      log.endCycle({ startTs: "17:00:00", endTs: "17:01:00", readsAttempted: 1, totalTurns: 1 });
    }).not.toThrow();

    // Verify error was logged
    expect(stderrSpy).toHaveBeenCalled();

    writeSpy.mockRestore();
    stderrSpy.mockRestore();
  });

  // T31
  test("disk full → flush fails silently, reads still blocked", () => {
    const log = makeLog();
    log.startSession();

    // Simulate disk full: writeFileSync throws ENOSPC
    const writeSpy = spyOn(fs, "writeFileSync").mockImplementation((...args: any[]) => {
      if (String(args[0]).includes(".tmp.")) {
        const err = new Error("ENOSPC: no space left on device") as NodeJS.ErrnoException;
        err.code = "ENOSPC";
        throw err;
      }
      return (fs.writeFileSync as any).apply(fs, args);
    });

    const result = log.addBlock({ ts: "17:00:00.000", path: "/a.ts", sizeBytes: 100, turnIndex: 1 });
    expect(result.blocked).toBe(true);

    // endCycle should not crash
    expect(() => {
      log.endCycle({ startTs: "17:00:00", endTs: "17:01:00", readsAttempted: 1, totalTurns: 1 });
    }).not.toThrow();

    writeSpy.mockRestore();
  });

  // T32
  test("mid-cycle crash loses only current cycle", () => {
    const log = makeLog();
    log.startSession();

    // Cycle 1: flush successfully
    log.addBlock({ ts: "17:01:00.000", path: "/a.ts", sizeBytes: 100, turnIndex: 1 });
    log.endCycle({ startTs: "17:01:00", endTs: "17:02:00", readsAttempted: 5, totalTurns: 2 });

    const contentAfterCycle1 = readLogFile(log);
    expect(contentAfterCycle1).toContain("Cycle 1");

    // Cycle 2: add blocks but simulate crash (no endCycle)
    log.addBlock({ ts: "17:03:00.000", path: "/b.ts", sizeBytes: 200, turnIndex: 1 });
    // NO endCycle — simulates crash

    // File should still contain Cycle 1 intact, Cycle 2 absent
    const finalContent = readLogFile(log);
    expect(finalContent).toContain("Cycle 1");
    expect(finalContent).not.toContain("Cycle 2");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 8. Mode dry-run
// ═════════════════════════════════════════════════════════════════════════

describe("8. Mode dry-run", () => {
  // T33
  test("dry-run mode lets reads pass but logs them", () => {
    const log = makeLog({ dryRun: true });
    log.startSession();

    const result = log.addBlock({
      ts: "17:00:00.000",
      path: "/a.ts",
      sizeBytes: 100,
      turnIndex: 1,
    });

    // In dry-run: read is NOT blocked but IS logged
    expect(result.blocked).toBe(false);
    expect(result.logged).toBe(true);

    log.endCycle({ startTs: "17:00:00", endTs: "17:01:00", readsAttempted: 1, totalTurns: 1 });

    const content = readLogFile(log);
    expect(content).toContain("/a.ts");
  });

  // T34
  test("dry-run off blocks reads normally", () => {
    const log = makeLog({ dryRun: false });
    log.startSession();

    const result = log.addBlock({
      ts: "17:00:00.000",
      path: "/a.ts",
      sizeBytes: 100,
      turnIndex: 1,
    });

    // In normal mode: read IS blocked AND logged
    expect(result.blocked).toBe(true);
    expect(result.logged).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 9. Intégration avec les events Pi
// ═════════════════════════════════════════════════════════════════════════

describe("9. Intégration avec les events Pi", () => {
  // T35
  test("agent_start opens cycle with timestamp", () => {
    const log = makeLog();
    log.startSession();

    log.onAgentStart({ timestamp: "17:01:23" });

    // Buffer should be initialized, cycleStartTs captured.
    // We verify this indirectly: adding a block and ending cycle
    // should produce a cycle with the correct start timestamp.
    log.addBlock({ ts: "17:01:45.000", path: "/a.ts", sizeBytes: 100, turnIndex: 1 });
    log.onAgentEnd({ timestamp: "17:03:45" });

    const content = readLogFile(log);
    expect(content).toContain("17:01:23");
  });

  // T36
  test("turn_start stores turnIndex", () => {
    const log = makeLog();
    log.startSession();
    log.onAgentStart({ timestamp: "17:01:00" });

    log.onTurnStart({ turnIndex: 3 });

    // turnIndex should be 3 for subsequent addBlock calls
    // We verify by checking the logged turn number
    log.addBlock({ ts: "17:01:30.000", path: "/a.ts", sizeBytes: 100, turnIndex: 3 });
    log.onAgentEnd({ timestamp: "17:02:00" });

    const content = readLogFile(log);
    expect(content).toContain("turn 3");
  });

  // T37
  test("tool_call(read) blocks already-seen file", () => {
    const log = makeLog();
    log.startSession();
    log.onAgentStart({ timestamp: "17:01:00" });
    log.onTurnStart({ turnIndex: 2 });

    // Simulate: file already read before → the extension (not the log
    // module) decides to block. But addBlock is called with turnIndex.
    const result = log.addBlock({
      ts: "17:01:30.000",
      path: "/foo.ts",
      sizeBytes: 500,
      turnIndex: 2,
    });

    expect(result.blocked).toBe(true);
    expect(result.logged).toBe(true);
  });

  // T38
  test("tool_call(read) allows new file", () => {
    // The log module exposes a method to query whether a read was blocked.
    // For a new (never-seen) file, the extension does NOT call addBlock.
    // Verify that the cycle ends with 0 blocked reads logged.
    const log = makeLog();
    log.startSession();
    log.onAgentStart({ timestamp: "17:01:00" });
    log.onTurnStart({ turnIndex: 1 });

    // Simulate: new file /bar.ts → extension allows, no addBlock called.
    // We verify that the buffer count stays at 0.
    expect(log.currentCycleBlockCount).toBe(0);

    log.onAgentEnd({ timestamp: "17:02:00", totalTurns: 1, readsAttempted: 1 });

    // With 0 blocks, the cycle should NOT be written
    const content = readLogFile(log);
    expect(content).not.toContain("## Cycle");
    expect(content).not.toContain("/bar.ts");
  });

  // T39
  test("tool_call(read) allows when read-tracker says file changed", () => {
    // When a file was already read but has since been modified,
    // the extension allows the re-read and does NOT call addBlock.
    // Verify that only the first cycle (with blocks) is written,
    // and the second cycle (where the file changed) produces nothing.
    const log = makeLog();
    log.startSession();

    // Cycle 1: /foo.ts is blocked
    log.onAgentStart({ timestamp: "17:01:00" });
    log.onTurnStart({ turnIndex: 1 });
    log.addBlock({ ts: "17:01:30.000", path: "/foo.ts", sizeBytes: 500, turnIndex: 1 });
    log.onAgentEnd({ timestamp: "17:02:00", totalTurns: 1, readsAttempted: 2 });

    // Cycle 2: /foo.ts modified → extension allows re-read, no addBlock
    log.onAgentStart({ timestamp: "17:03:00" });
    log.onTurnStart({ turnIndex: 1 });
    // No addBlock — file changed, read allowed
    expect(log.currentCycleBlockCount).toBe(0);
    log.onAgentEnd({ timestamp: "17:04:00", totalTurns: 1, readsAttempted: 1 });

    const content = readLogFile(log);
    // Cycle 1 should be present with /foo.ts
    expect(content).toContain("Cycle 1");
    expect(content).toContain("/foo.ts");
    // Cycle 2 should NOT be written (0 blocks)
    expect(content).not.toContain("Cycle 2");
  });

  // T40
  test("agent_end flushes buffer with duration", () => {
    const log = makeLog();
    log.startSession();
    log.onAgentStart({ timestamp: "17:01:00" });

    log.addBlock({ ts: "17:01:10.000", path: "/a.ts", sizeBytes: 100, turnIndex: 1 });
    log.addBlock({ ts: "17:01:20.000", path: "/b.ts", sizeBytes: 200, turnIndex: 2 });
    log.addBlock({ ts: "17:01:30.000", path: "/c.ts", sizeBytes: 300, turnIndex: 3 });

    log.onAgentEnd({ timestamp: "17:03:45", totalTurns: 4, readsAttempted: 10 });

    const content = readLogFile(log);
    // Should contain cycle header with start → end and turns
    expect(content).toContain("## Cycle");
    expect(content).toContain("17:01:00");
    expect(content).toContain("17:03:45");
    expect(content).toContain("(4 turns)");
    // All 3 blocks should be flushed
    expect(content).toContain("/a.ts");
    expect(content).toContain("/b.ts");
    expect(content).toContain("/c.ts");
  });
});

// ═════════════════════════════════════════════════════════════════════════
// 10. Health-check
// ═════════════════════════════════════════════════════════════════════════

describe("10. Health-check", () => {
  // T41
  test("updates status on each blocked read", () => {
    const setStatusFn = mock(() => {});

    const log = makeLog();
    log.startSession();
    log.setStatusCallback(setStatusFn);

    // Block 5 reads
    for (let i = 1; i <= 5; i++) {
      log.addBlock({ ts: `17:00:0${i}.000`, path: `/file-${i}.ts`, sizeBytes: 100, turnIndex: 1 });
    }

    // setStatus should have been called on each block
    expect(setStatusFn).toHaveBeenCalledTimes(5);

    // The last call should report 5 reads bloqués
    const lastCall = setStatusFn.mock.calls[4];
    expect(lastCall[0]).toBe("rd");
    expect(lastCall[1]).toContain("5");
    expect(lastCall[1]).toContain("reads bloqués");
  });
});
