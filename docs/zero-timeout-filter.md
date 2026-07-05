# Zero-Timeout Filter

- **Date**: 2026-07-05
- **Type**: Extension (no patch needed)
- **File**: `~/.pi/agent/extensions/zero-timeout-filter.ts`

## What

Silently removes the shell timeout from the git-commits-push skill invocation
command. The skill manages its own deadlines
(600s per delegation), so an external timeout would orphan the run.

## How It Works

Listens to `tool_call` → `bash`. If the command contains both `bun run start`
and `git-commits-push`, it deletes `event.input.timeout` before the tool
executes. The command runs normally, but without a timeout.

```typescript
pi.on("tool_call", async (event) => {
  if (!isToolCallEventType("bash", event)) return;
  const cmd = event.input.command;
  if (!cmd || typeof cmd !== "string") return;
  if (!cmd.includes("bun run start")) return;
  if (!cmd.includes("git-commits-push")) return;
  delete event.input.timeout;
});
```

No logging, no blocking, no side effects. If the command does not match, the
handler returns immediately.

## Relevant Files

| File | Purpose | Versioned |
|------|---------|-----------|
| `dotpi/extensions/zero-timeout-filter.ts` | Pi extension | ✅ |
| `dotpi/extensions/__tests__/zero-timeout-filter.test.ts` | Tests | ✅ |

## Background

Added because agents sometimes set a short shell timeout (e.g. `timeout: 60`)
on the skill invocation. This kills the pipeline mid-flight — retries get
emitted but never consumed, leaving orphaned runs in `.turnlock/`. The filter
makes the timeout stripping automatic so the agent doesn't have to remember.