# Read Deduplicator

## Where / What

An extension that intercepts `read` tool calls and blocks re-reads when the file
is already present — unmodified and in full — in the current provider context.
Blocked reads are logged to a per-session markdown file for statistics.

| What | Where |
|------|-------|
| Extension entry point | `~/.pi/agent/extensions/read-deduplicator.ts` |
| Internal modules (6) | `~/.pi/agent/extensions/read-deduplicator-internals/` |
| Storage (tracker) | In-memory `Map` — heap only, destroyed with the Pi process on session end |
| Blocked-reads logs | `~/neelopedia/stats/read-deduplicator/<session-id>.md` |
| Path filter config | `~/neelopedia/stats/read-deduplicator/.pathfilter` (optional) |


---


## How It Works

### Tracker (read deduplication)

The extension hooks Pi events: `turn_start`, `before_provider_request`,
`tool_call`, and `tool_result`.

Each tracked file holds:

| Field | Meaning |
|-------|---------|
| `fingerprint` | `mtimeMs:size` of the file on disk (whole file, not the requested portion) |
| `turn` | Turn number at which the file was last injected |
| `injectedText` | Exact text injected into the prompt (formatted, with line numbers) |
| `stillInContext` | Whether `injectedText` was found in the most recent provider request payload |

Fingerprint — computed on the **whole file**, stable across `offset`/`limit` variations:

```ts
const stat = fs.statSync(path);
const fingerprint = `${stat.mtimeMs}:${stat.size}`;
```

Decision table on every `tool_call` of type `read`:

| Condition | Action |
|-----------|--------|
| File not tracked | Allow. Store `{fingerprint, turn, injectedText}` on `tool_result`. |
| Tracked, fingerprint matches, `stillInContext` = `true` | **Block** → respond `(already in context, turn N)`, log to session file. |
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

### Blocked-Reads Log

The same `before_provider_request` handler flushes a buffer of blocked reads
to the session's log file at each cycle boundary.

**Output**: `~/neelopedia/stats/read-deduplicator/<session-id>.md`

Format:

```markdown
# Read Deduplicator — Blocked Reads Log
> **Format version**: 0.1.0

# Session: <session-id>
**Started** : <ISO timestamp>
**CWD** : `<cwd>`

## Cycle N — <start> → <end> (X turns)
**Reads** : <attempted> tentés / <blocked> bloqués
`<HH:MM:SS.SSS>` `<absolute/path>` (<readable size> / <B> B) — turn <N>
```

Key behaviors:

- **One file per session**. Named by Pi's session ID (`<timestamp>_<uuid>.md`).
  Ephemeral sessions get `ephemeral-<timestamp>.md`.
- **Append-only with atomic writes**: read → modify in memory → write to
  `.tmp.<pid>` → `rename` (atomic on POSIX).
- **Buffered per agent cycle**: blocked reads accumulate in RAM, flushed on
  cycle boundary (`agent_end` or next `before_provider_request`).
  If Pi crashes mid-cycle, only the current cycle is lost — the file stays clean.
- **Session collision detection**: if a file already exists with a different
  session header, a `---` separator is inserted before the new session.
- **Path filtering**: optional `.pathfilter` (one path prefix per line).
  Matching reads are blocked but not logged.
- **Dry-run mode**: `RD_DRY_RUN=true` logs blocked reads without actually blocking.
- **Health-check**: reports `N reads bloqués` via `pi.ui.setStatus("rd", ...)`.

### Cycle Lifecycle

| Pi event | Role |
|----------|------|
| `agent_start` | Opens a cycle. Captures start timestamp. |
| `turn_start` | Sets `currentTurn` from `event.turnIndex`. |
| `tool_call` (read) | Detects blocked reads, calls `addBlock()`. |
| `before_provider_request` | Updates `stillInContext` for all tracked files. Flushes the cycle buffer. |
| `agent_end` | Flushes remaining buffer entries. |

### Limits

| Limit | Impact |
|-------|--------|
| `includes()` is strict — any formatting divergence breaks the match | File is re-read normally (no false block) |
| `offset`/`limit` reads track each portion separately | Full file read after partial read → miss → re-read (acceptable) |
| Benefit depends on provider (Anthropic caches the prompt prefix) | Primary gain is context space, not cost |
| File modified between reads (mtime changed) | Fingerprint differs → re-read allowed, correct behavior |
| Log buffer lost on Pi crash mid-cycle | Current cycle entries not written; prior cycles intact (atomic writes) |


---


## Relevant Files

| File | Purpose | Versioned |
|------|---------|-----------|
| `~/.pi/agent/extensions/read-deduplicator.ts` | Extension entry point (hooks Pi events) | ✅ committed |
| `~/.pi/agent/extensions/read-deduplicator-internals/read-tracker.ts` | In-memory file tracker (`Map`) | ✅ committed |
| `~/.pi/agent/extensions/read-deduplicator-internals/blocked-log.ts` | Log buffer, format, flush orchestration | ✅ committed |
| `~/.pi/agent/extensions/read-deduplicator-internals/atomic-writer.ts` | Atomic append (read-modify-write + rename) | ✅ committed |
| `~/.pi/agent/extensions/read-deduplicator-internals/format.ts` | Size formatting, block line, cycle header | ✅ committed |
| `~/.pi/agent/extensions/read-deduplicator-internals/path-normalize.ts` | Path resolution, symlink resolution, filter matching | ✅ committed |
| `~/.pi/agent/extensions/read-deduplicator-internals/session-file.ts` | Session file path, header, collision detection | ✅ committed |
| `~/.pi/agent/extensions/__tests__/read-deduplicator.test.ts` | Unit tests | ✅ committed |
| `~/.pi/agent/extensions/__tests__/read-deduplicator.integration.test.ts` | Integration tests | ✅ committed |
| `~/.pi/agent/specs/read-deduplicator.md` | Design spec (core deduplication) | ✅ committed |
| `~/.pi/agent/specs/read-deduplicator-blocked-log.md` | Design spec (blocked-reads log) | ✅ committed |
| `~/neelopedia/stats/read-deduplicator/*.md` | Per-session blocked-reads logs | ❌ gitignored |
| `~/neelopedia/stats/read-deduplicator/.pathfilter` | Optional path filter config | ❌ gitignored |


---


## Background

Pi's `read` tool was re-injecting identical file contents across multiple turns,
wasting context space and provider tokens. The extension short-circuits re-reads
by tracking which files are already in context and blocking duplicate reads
unless the file has changed or its content has been truncated from the payload.

The blocked-reads log was added (2026-06-29) to enable cross-session statistics:
an agent can read the log files and measure how many bytes of re-reads were avoided.
