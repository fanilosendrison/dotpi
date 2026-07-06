# Read Deduplicator

## Where / What

An extension that intercepts `read` tool calls and blocks re-reads when the file
is already present — unmodified and in full — in the current provider context.
Reads (allowed and blocked) are logged to a JSONL event file.

| What | Where |
|------|-------|
| Extension entry point | `~/.pi/agent/extensions/read-deduplicator.ts` |
| Internal modules | `~/.pi/agent/extensions/read-deduplicator-internals/` |
| Storage (tracker) | In-memory `Map` — heap only, destroyed with the Pi process on session end |
| Event log (JSONL) | `~/neelopedia/stats/pi/read-deduplicator/events.jsonl` |

## How It Works

### Tracker (read deduplication)

The extension hooks Pi events: `turn_start`, `before_provider_request`,
`tool_call`, and `tool_result`.

Each tracked file holds:

| Field | Meaning |
|-------|---------|
| `fingerprint` | `mtimeMs:size:sha256(first 4KB)[:16]` |
| `turn` | Turn number at which the file was last injected |
| `injectedText` | Exact text injected into the prompt (formatted, with line numbers) |
| `stillInContext` | Whether `injectedText` was found in the most recent provider request payload |

#### Fingerprint

```ts
const stat = fs.statSync(path);
const fingerprint = `${stat.mtimeMs}:${stat.size}:${sampleFileHash(path)}`;
```

The content sample (`sha256` of the first 4 KB, truncated to 16 hex chars)
catches same-second, same-length in-place edits.

#### Decision table

On every `tool_call` of type `read`:

| Condition | Action |
|-----------|--------|
| File not tracked | Allow. Store `{fingerprint, turn, injectedText}` on `tool_result`. |
| Tracked, fingerprint matches, `stillInContext` = `true` | **Block** → respond `(already in context, turn N)`, log `file_access{action: "blocked"}`. |
| Tracked, fingerprint matches, `stillInContext` = `false` | Allow (truncated from context). Update `turn` and `injectedText`. |
| Tracked, fingerprint differs (file modified) | Allow. Replace the entry. |

`stillInContext` is updated on `before_provider_request` by checking each
tracked entry's `injectedText` against the current payload text.

### Event Log (JSONL)

Single event type `file_access` with `action` discriminator:

| `details.action` | When |
|---|---|
| `blocked` | Read blocked (file already in context) |
| `read` | Successful read (allowed) |

```json
{
  "eventType": "file_access",
  "details": {
    "action": "blocked",
    "path": "/src/foo.ts",
    "sizeBytes": 1024,
    "turnIndex": 3,
    "parentModel": "deepseek-v4-flash",
    "thinkingLevel": "xhigh",
    "blockedReason": "already in context (turn 1)"
  }
}
```

Ratio: `blocked / (blocked + read)`.

No `cycle_summary`, no `cycleId`, no RAM counters.

### Cycle Lifecycle

| Pi event | Role |
|----------|------|
| `turn_start` | Sets `currentTurn`. |
| `tool_call` (read) | Fingerprint + decision + log `file_access{blocked}` if blocked. |
| `tool_result` (read) | Updates tracker, logs `file_access{read}`. |
| `before_provider_request` | Updates `stillInContext` for all tracked files. |

### Health Check

The extension shows the running block count in Pi's status bar via
`pi.ui.setStatus("rd", ...)`.

## Relevant Files

| File | Purpose | Versioned |
|------|---------|-----------|
| `~/.pi/agent/extensions/read-deduplicator.ts` | Extension entry point | ✅ |
| `~/.pi/agent/extensions/read-deduplicator-internals/read-tracker.ts` | In-memory file tracker | ✅ |
| `~/.pi/agent/extensions/__tests__/read-deduplicator.test.ts` | Unit tests for tracker | ✅ |
| `~/.pi/agent/extensions/__tests__/read-deduplicator.integration.test.ts` | Integration tests | ✅ |
