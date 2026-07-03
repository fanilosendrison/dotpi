# Read Deduplicator

## Where / What

An extension that intercepts `read` tool calls and blocks re-reads when the file
is already present — unmodified and in full — in the current provider context.
Reads (allowed and blocked) are streamed to a JSONL event log for cross-session
statistics.

| What | Where |
|------|-------|
| Extension entry point | `~/.pi/agent/extensions/read-deduplicator.ts` |
| Internal modules (5) | `~/.pi/agent/extensions/read-deduplicator-internals/` |
| Storage (tracker) | In-memory `Map` — heap only, destroyed with the Pi process on session end |
| Event log (JSONL) | `~/neelopedia/stats/pi/read-deduplicator/events.jsonl` |
| Path filter config | `~/neelopedia/stats/pi/read-deduplicator/.pathfilter` (optional) |


---


## How It Works

### Tracker (read deduplication)

The extension hooks Pi events: `session_start`, `agent_start`, `turn_start`,
`before_provider_request`, `agent_end`, `tool_call`, and `tool_result`.

Each tracked file holds:

| Field | Meaning |
|-------|---------|
| `fingerprint` | `mtimeMs:size:sha256(first 4KB)[:16]` — see below |
| `turn` | Turn number at which the file was last injected |
| `injectedText` | Exact text injected into the prompt (formatted, with line numbers) |
| `stillInContext` | Whether `injectedText` was found in the most recent provider request payload |

#### Fingerprint

Computed on the **whole file**, stable across `offset`/`limit` variations:

```ts
const stat = fs.statSync(path);
const fingerprint = `${stat.mtimeMs}:${stat.size}:${sampleFileHash(path)}`;
```

The content sample (`sha256` of the first 4 KB, truncated to 16 hex chars =
64 bits) catches the edge case where a file is modified **in-place** with
`mtimeMs` unchanged (same-second write on coarse-resolution FS) **and** size
unchanged (same-length edit). Without it, that edit would be invisible to the
fingerprint and produce a false positive block.

| Field | What it catches | What it misses |
|-------|-----------------|----------------|
| `mtimeMs` | In-place edits with updated mtime | Same-second writes |
| `size` | Length-changing edits | Same-length edits |
| `sha256[:16]` of first 4 KB | Any difference in the first 4 KB | Edits only after byte 4096 |

#### Decision table

On every `tool_call` of type `read`:

| Condition | Action |
|-----------|--------|
| File not tracked | Allow. Store `{fingerprint, turn, injectedText}` on `tool_result`. |
| Tracked, fingerprint matches, `stillInContext` = `true` | **Block** → respond `(already in context, turn N)`, log `block` event. |
| Tracked, fingerprint matches, `stillInContext` = `false` | Allow (truncated from context). Update `turn` and `injectedText`. |
| Tracked, fingerprint differs (file modified) | Allow. Replace the entry. |

`stillInContext` is updated on `before_provider_request` by extracting all text
from the payload messages array and checking each tracked entry via `includes()`:

```ts
const messages = (event.payload as any)?.messages ?? [];
const payloadText = messages
  .flatMap((m: any) =>
    Array.isArray(m.content)
      ? m.content.filter((c: any) => c.type === "text").map((c: any) => c.text)
      : [typeof m.content === "string" ? m.content : ""],
  )
  .join("\n");

for (const [path, entry] of tracker.entries()) {
  tracker.setStillInContext(path, payloadText.includes(entry.injectedText));
}
```

### Event Log (JSONL)

The log is a single append-only file of JSON events:

**Output**: `~/neelopedia/stats/pi/read-deduplicator/events.jsonl`

#### Event types

| `eventType` | When | `details` |
|-------------|------|-----------|
| `block` | Every blocked read | `{path, sizeBytes, turnIndex}` |
| `read` | Every successful read | `{path, sizeBytes, turnIndex}` |
| `cycle_summary` | End of each provider cycle | `{startTs, endTs, readsAttempted, blockedCount, totalTurns}` |

#### Common fields

Every event carries:

| Field | Source |
|-------|--------|
| `timestamp` | ISO 8601 |
| `eventId` | `crypto.randomUUID()` |
| `extension` | `"read-deduplicator"` |
| `agent` | `"pi"` |
| `workspace` | `process.cwd()` |
| `sessionId` | Generated at extension load (per Pi process) |
| `cycleId` | Rotated on each `agent_start` and on `endCycle` |

#### Writing

Atomic append-only via `read → modify → write to .tmp.<pid> → rename`:

```ts
const existingContent = fs.existsSync(filePath)
  ? fs.readFileSync(filePath, "utf-8")
  : "";
fs.writeFileSync(`${filePath}.tmp.${process.pid}`, existingContent + newContent);
fs.renameSync(`${filePath}.tmp.${process.pid}`, filePath);
```

#### Path filtering

Optional `.pathfilter` (one path prefix per line, `#` for comments). Matching
reads (allowed or blocked) are skipped — **they are neither logged nor counted
in `cycle_summary.readsAttempted`**:

```
# /Users/famillesendrison/.ssh
/Users/famillesendrison/Dropbox/Private
```

### Configuration

| Knob | How | Effect |
|------|-----|--------|
| Dry-run mode | `RD_DRY_RUN=true` env var | Logs `block` events but returns `block: false` — reads go through normally. Useful to measure how many blocks *would* fire. |

### Cycle Lifecycle

| Pi event | Role |
|----------|------|
| `session_start` | Calls `blockedLog.startSession()` — ensures stats dir, loads path filter. |
| `agent_start` | Opens a cycle. Captures `cycleStartTs`, rotates `cycleId`. |
| `turn_start` | Sets `currentTurn`, records turn in `cycleTurns`. |
| `tool_call` (read) | Detects blocked reads, calls `addBlock()` and possibly blocks the call. Bumps `cycleReadsAttempted`. |
| `tool_result` (read) | Updates tracker, calls `addRead()` for telemetry. |
| `before_provider_request` | Updates `stillInContext` for all tracked files. Calls `endCycle()` to flush a `cycle_summary` event with `readsAttempted` and `blockedCount`. |
| `agent_end` | Final `cycle_summary` flush if the cycle had any traffic. |

### Health Check

The extension wires `pi.ui.setStatus("rd", "N reads bloqués")` so the running
block count is visible in Pi's status bar (updated each time a block fires).

### Limits

| Limit | Impact |
|-------|--------|
| `includes()` is strict — any formatting divergence breaks the match | File is re-read normally (no false block) |
| `offset`/`limit` reads track each portion separately | Full file read after partial read → miss → re-read (acceptable) |
| Benefit depends on provider (Anthropic caches the prompt prefix) | Primary gain is context space, not cost |
| SHA sample only covers first 4 KB | Edits beyond byte 4096 with unchanged `mtimeMs:size` are missed — false block possible (rare in practice) |
| Log buffer lost on Pi crash mid-cycle | Current cycle's `cycle_summary` not written; per-event entries are written immediately, so they're safe |


---


## Relevant Files

| File | Purpose | Versioned |
|------|---------|-----------|
| `~/.pi/agent/extensions/read-deduplicator.ts` | Extension entry point (hooks Pi events) | ✅ committed |
| `~/.pi/agent/extensions/read-deduplicator-internals/read-tracker.ts` | In-memory file tracker (`Map`) | ✅ committed |
| `~/.pi/agent/extensions/read-deduplicator-internals/blocked-log.ts` | JSONL event log buffer + flush orchestration | ✅ committed |
| `~/.pi/agent/extensions/read-deduplicator-internals/atomic-writer.ts` | Atomic append (read-modify-write + rename) | ✅ committed |
| `~/.pi/agent/extensions/read-deduplicator-internals/path-normalize.ts` | Path resolution, symlink resolution, filter loading/matching | ✅ committed |
| `~/.pi/agent/extensions/read-deduplicator-internals/session-file.ts` | Stats dir creation, `events.jsonl` path | ✅ committed |
| `~/.pi/agent/extensions/__tests__/blocked-log.test.ts` | Unit tests (15) — JSONL event shape, dry-run, path filter, counter ownership | ✅ committed |
| `~/.pi/agent/extensions/__tests__/read-deduplicator.test.ts` | Unit tests (9) — tracker behavior | ✅ committed |
| `~/.pi/agent/extensions/__tests__/read-deduplicator.integration.test.ts` | Integration tests (6) — full decision chain | ✅ committed |
| `~/.pi/agent/specs/read-deduplicator.md` | Design spec (core deduplication) | ✅ committed |
| `~/.pi/agent/specs/read-deduplicator-blocked-log.md` | Design spec (JSONL event log) | ✅ committed |
| `~/neelopedia/stats/pi/read-deduplicator/events.jsonl` | Telemetry event log | ❌ gitignored |
| `~/neelopedia/stats/pi/read-deduplicator/.pathfilter` | Optional path filter config | ❌ gitignored |


---


## Background

Pi's `read` tool was re-injecting identical file contents across multiple turns,
wasting context space and provider tokens. The extension short-circuits re-reads
by tracking which files are already in context and blocking duplicate reads
unless the file has changed or its content has been truncated from the payload.

### Evolution

| Date | Change |
|------|--------|
| Initial | In-memory tracker + per-session markdown log. |
| Fingerprint hardening | Added SHA-256 sample of first 4 KB to detect same-second, same-size in-place edits. |
| Log migration | Per-session markdown was replaced with a single append-only `events.jsonl` so cross-session statistics are machine-parseable. |
| Read telemetry | `addRead` was added so every successful read is logged alongside blocks — enables `sum(read) + sum(block) == cycle_summary.readsAttempted` invariant per cycle. |
| Dry-run + health check | `RD_DRY_RUN` env var and `pi.ui.setStatus("rd", ...)` were wired through the extension entry point (previously defined in internals but never called). |