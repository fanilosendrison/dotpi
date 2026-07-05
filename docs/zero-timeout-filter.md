# Zero-Timeout Filter

- **Date**: 2026-07-05
- **Type**: Extension (no patch needed)
- **File**: `~/.pi/agent/extensions/zero-timeout-filter.ts`

## What

Silently removes the shell timeout from the git-commits-push skill invocation
command. The skill manages its own deadlines (600s per delegation), so an
external timeout would orphan the run.

Logs every stripped timeout to `~/neelopedia/stats/pi/zero-timeout-filter/events.jsonl`.

## How It Works

Listens to `tool_call` → `bash`. If the command contains both `bun run start`
and `.agents/skills/git-commits-push`, it deletes `event.input.timeout` before
the tool executes. Logs a `timeout_stripped` event only when a timeout was
actually present.

```typescript
pi.on("tool_call", async (event) => {
  if (!isToolCallEventType("bash", event)) return;
  const cmd = event.input.command;
  if (!cmd || typeof cmd !== "string") return;
  if (!cmd.includes("bun run start")) return;
  if (!cmd.includes(".agents/skills/git-commits-push")) return;
  delete event.input.timeout;
  if (event.input.timeout !== undefined) return;
  statsLog.logTimeoutStripped({ ... });
});
```

## Stats

```json
{
  "eventType": "timeout_stripped",
  "details": {
    "originalTimeout": 30,
    "parentModel": "deepseek-v4-flash",
    "thinkingLevel": "xhigh",
    "toolCallId": "call_00_..."
  }
}
```

The `toolCallId` matches the enforcer's `enforcer_triggered` event for the same
tool invocation. Join on it to compute the ratio.

## Relevant Files

| File | Purpose | Versioned |
|------|---------|-----------|
| `dotpi/extensions/zero-timeout-filter.ts` | Pi extension | ✅ |
| `dotpi/extensions/zero-timeout-filter-internals/stats-log.ts` | Stats logging module | ✅ |
| `dotpi/extensions/__tests__/zero-timeout-filter.test.ts` | Extension tests | ✅ |
| `dotpi/extensions/zero-timeout-filter-internals/__tests__/stats-log.test.ts` | Stats-log tests | ✅ |

## Background

Added because agents sometimes set a short shell timeout (e.g. `timeout: 60`)
on the skill invocation. This kills the pipeline mid-flight — retries get
emitted but never consumed, leaving orphaned runs in `.turnlock/`. The filter
makes the timeout stripping automatic so the agent doesn't have to remember.
