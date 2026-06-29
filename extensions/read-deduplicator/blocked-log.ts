import { formatBlockLine, formatCycleHeader } from "./format";
import { normalizePath, loadPathFilter, matchesFilter } from "./path-normalize";
import { ensureDirectory, resolveSessionFilePath, writeSessionHeader } from "./session-file";
import { atomicAppend } from "./atomic-writer";

export interface AddBlockResult {
  blocked: boolean;
  logged: boolean;
}

export interface BlockedLogAPI {
  filePath: string;
  currentCycleBlockCount: number;
  startSession(): void;
  addBlock(entry: {
    ts: string;
    path: string;
    sizeBytes: number;
    turnIndex: number;
  }): AddBlockResult;
  endCycle(meta: {
    startTs: string;
    endTs: string;
    readsAttempted: number;
    totalTurns: number;
  }): void;
  onAgentStart(event: { timestamp: string }): void;
  onTurnStart(event: { turnIndex: number }): void;
  onAgentEnd(event: { timestamp: string; totalTurns?: number; readsAttempted?: number }): void;
  setStatusCallback(fn: (key: string, msg: string) => void): void;
}

export function createBlockedLog(opts: {
  statsDir: string;
  sessionId?: string;
  cwd: string;
  dryRun: boolean;
  forceFilePath?: string;
}): BlockedLogAPI {
  const filePath = resolveSessionFilePath(opts.statsDir, opts.sessionId, opts.forceFilePath);
  let pathFilters: string[] = [];
  let buffer: string[] = [];
  let absoluteCycleNum = 0;
  let cycleStartTs: string | null = null;
  let currentTurnIndex = 0;
  let cycleReadsAttempted = 0;
  let totalSessionBlocked = 0;
  let statusCallback: ((key: string, msg: string) => void) | null = null;

  function flushBuffer(startTs: string, endTs: string, readsAttempted: number, totalTurns: number) {
    if (buffer.length === 0) {
      absoluteCycleNum++;
      return;
    }

    absoluteCycleNum++;
    const header = formatCycleHeader(
      absoluteCycleNum,
      startTs,
      endTs,
      totalTurns,
      readsAttempted,
      buffer.length
    );
    
    const newContent = header + buffer.join("\n") + "\n\n";
    atomicAppend(filePath, newContent);
    buffer = [];
  }

  return {
    filePath,
    
    get currentCycleBlockCount() {
      return buffer.length;
    },

    startSession() {
      ensureDirectory(opts.statsDir);
      writeSessionHeader(filePath, opts.sessionId, opts.cwd);
      pathFilters = loadPathFilter(opts.statsDir);
    },

    addBlock(entry) {
      cycleReadsAttempted++;
      try {
        const normalized = normalizePath(entry.path, opts.cwd);
        if (!normalized) {
          return { blocked: false, logged: false };
        }

        if (matchesFilter(normalized, pathFilters)) {
          return { blocked: true, logged: false };
        }

        const formatted = formatBlockLine({
          ts: entry.ts,
          path: normalized,
          sizeBytes: entry.sizeBytes,
          turnIndex: entry.turnIndex,
        });

        buffer.push(formatted);
        totalSessionBlocked++;

        if (statusCallback) {
          statusCallback("rd", `${totalSessionBlocked} reads bloqués`);
        }

        if (buffer.length >= 2000) {
          flushBuffer(cycleStartTs ?? entry.ts, entry.ts, cycleReadsAttempted, entry.turnIndex);
          cycleStartTs = entry.ts;
          cycleReadsAttempted = 0;
        }

        return { blocked: !opts.dryRun, logged: true };
      } catch (err) {
        process.stderr.write(`[read-deduplicator] Error adding block: ${err}\n`);
        return { blocked: true, logged: false };
      }
    },

    endCycle(meta) {
      try {
        flushBuffer(meta.startTs, meta.endTs, meta.readsAttempted, meta.totalTurns);
        cycleStartTs = meta.endTs;
        cycleReadsAttempted = 0;
      } catch (err) {
        process.stderr.write(`[read-deduplicator] Error ending cycle: ${err}\n`);
        buffer = [];
      }
    },

    onAgentStart(event) {
      cycleStartTs = event.timestamp;
      cycleReadsAttempted = 0;
      buffer = [];
    },

    onTurnStart(event) {
      currentTurnIndex = event.turnIndex;
    },

    onAgentEnd(event) {
      flushBuffer(cycleStartTs ?? event.timestamp, event.timestamp, cycleReadsAttempted, event.totalTurns ?? 1);
    },

    setStatusCallback(fn) {
      statusCallback = fn;
    },
  };
}
