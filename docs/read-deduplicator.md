# Read Deduplicator

## Where / What

An extension that intercepts `read` tool calls and serves cached read content
when the same file and line range are requested again with the same file
fingerprint. The underlying read is allowed to execute, then `tool_result`
middleware swaps the result content with the cached text. Reads and cache serves
are logged to a JSONL event file.

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
| `stillInContext` | Diagnostic flag showing whether `injectedText` was found in the most recent provider request payload |
| `offset` | Optional 1-indexed starting line from the read request |
| `limit` | Optional maximum number of lines from the read request |

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
| File not tracked | Allow. Store `{fingerprint, turn, injectedText, offset, limit}` on `tool_result`. |
| Tracked, fingerprint + `offset` + `limit` match | Allow the read, then replace the `tool_result` content with cached text and log `file_access{action: "cache_served"}`. |
| Tracked, fingerprint matches but `offset` or `limit` differ | Allow. Replace the entry on `tool_result`. |
| Tracked, fingerprint differs (file modified) | Allow. Replace the entry. |

`stillInContext` is updated on `before_provider_request` by checking each
tracked entry's `injectedText` against the current payload text. It is retained
for diagnostics, but it no longer controls the cache-serve decision.

### Event Log (JSONL)

Single event type `file_access` with `action` discriminator:

| `details.action` | When |
|---|---|
| `cache_served` | Matching file/range result returned from cache |
| `read` | Successful read recorded for future cache serves |

```json
{
  "eventType": "file_access",
  "details": {
    "action": "cache_served",
    "path": "/src/foo.ts",
    "sizeBytes": 1024,
    "turnIndex": 3,
    "parentModel": "deepseek-v4-flash",
    "thinkingLevel": "xhigh"
  }
}
```

Ratio: `cache_served / (cache_served + read)`.

No `cycle_summary`, no `cycleId`, no RAM counters.

### Cycle Lifecycle

| Pi event | Role |
|----------|------|
| `turn_start` | Sets `currentTurn`. |
| `tool_call` (read) | Fingerprint + range lookup; records pending cache serves by `toolCallId`. |
| `tool_result` (read) | Swaps cached content on a confirmed hit, or updates tracker and logs `file_access{read}`. |
| `before_provider_request` | Updates `stillInContext` for all tracked files. |

### Health Check

No status bar health check is currently implemented.

## Relevant Files

| File | Purpose | Versioned |
|------|---------|-----------|
| `~/.pi/agent/extensions/read-deduplicator.ts` | Extension entry point | ✅ |
| `~/.pi/agent/extensions/read-deduplicator-internals/read-tracker.ts` | In-memory file tracker | ✅ |
| `~/.pi/agent/extensions/__tests__/read-deduplicator.test.ts` | Unit tests for tracker | ✅ |
| `~/.pi/agent/extensions/__tests__/read-deduplicator.integration.test.ts` | Integration tests | ✅ |
