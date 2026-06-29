# Read Deduplicator

## Where / What

An extension that intercepts `read` tool calls and blocks re-reads when the file
is already present — unmodified and in full — in the current provider context.

| What | Where |
|------|-------|
| Extension entry point | `~/.pi/agent/extensions/read-deduplicator.ts` |
| Tracker core | `~/.agents/agent-hooks/read-deduplicator/src/core/read-tracker.ts` |
| Storage | In-memory `Map` — heap only, destroyed with the Pi process on session end |


---


## How It Works

The extension hooks four Pi events: `turn_start`, `before_provider_request`, `tool_call`, and `tool_result`.

### Tracker state

Each tracked file holds:

| Field | Meaning |
|-------|---------|
| `fingerprint` | `mtimeMs:size` of the file on disk |
| `turn` | Turn number at which the file was last injected |
| `injectedText` | Exact text that was injected into the prompt (formatted, with line numbers) |
| `stillInContext` | Whether `injectedText` was found in the most recent provider request payload |

### Fingerprint

Computed on the **whole file**, not the portion requested. Stable across
`offset`/`limit` variations on the same unmodified file:

```ts
const stat = fs.statSync(path);
const fingerprint = `${stat.mtimeMs}:${stat.size}`;
```

`mtime + size` is sufficient to detect modifications. Two reads of the same
unmodified file produce the same fingerprint regardless of `offset`/`limit`.

### Decision table

On every `tool_call` of type `read`:

| Condition | Action |
|-----------|--------|
| File not tracked | Allow. Store `{fingerprint, turn, injectedText}` on `tool_result`. |
| Tracked, fingerprint matches, `stillInContext` = `true` | **Block** → respond `(already in context, turn N)` |
| Tracked, fingerprint matches, `stillInContext` = `false` | Allow (file was truncated from context). Update `turn` and `injectedText`. |
| Tracked, fingerprint differs (file modified) | Allow. Replace the entry with new fingerprint. |

### `stillInContext` update

On `before_provider_request`, the extension extracts all text from the payload
messages array and checks each tracked entry via `includes()`:

```ts
const messages = event.payload.messages ?? [];
const payloadText = messages
  .flatMap((m) =>
    Array.isArray(m.content)
      ? m.content.filter((c) => c.type === "text").map((c) => c.text)
      : [typeof m.content === "string" ? m.content : ""],
  )
  .join("\n");

for (const [path, entry] of tracker.entries()) {
  tracker.setStillInContext(path, payloadText.includes(entry.injectedText));
}
```

No `JSON.stringify` — it would escape newlines and break the match.

### Limits

| Limit | Impact |
|-------|--------|
| `includes()` is strict — any formatting divergence breaks the match | File is re-read normally (no false block) |
| `offset`/`limit` reads track each portion separately | Reading the full file after a partial read → miss → re-read (acceptable) |
| Benefit depends on provider (Anthropic caches the prompt prefix) | Primary gain is context space, not cost |
| File modified between reads (mtime changed) | Fingerprint differs → re-read allowed, correct behavior |


---


## Relevant Files

| File | Purpose | Versioned |
|------|---------|-----------|
| `~/.pi/agent/extensions/read-deduplicator.ts` | Extension entry point | ✅ committed |
| `~/.agents/agent-hooks/read-deduplicator/src/core/read-tracker.ts` | Shared tracker logic | ✅ committed |
| `~/.pi/agent/extensions/__tests__/read-deduplicator.test.ts` | Unit tests | ✅ committed |
| `~/.pi/agent/extensions/__tests__/read-deduplicator.integration.test.ts` | Integration tests | ✅ committed |
| `~/.pi/agent/specs/read-deduplicator.md` | Design spec | ✅ committed |


---


## Background

Pi's `read` tool was re-injecting identical file contents across multiple turns,
wasting context space and provider tokens. The extension short-circuits re-reads
by tracking which files are already in context and blocking duplicate reads
unless the file has changed or its content has been truncated from the payload.
