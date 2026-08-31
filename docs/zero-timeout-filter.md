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

Listens to `tool_call` → `bash` and consumes
`recognizeGitCommitsPushCommand()` from the shared dotagents enforcement core.
It strips `event.input.timeout` only when the result is `pnpm-launch`;
retired launch syntax, slash invocations, incomplete commands, lookalike paths,
unsafe separators, and appended commands are ignored. A `timeout_stripped` event is
written only when a timeout was actually present.

```typescript
const recognition = recognizeGitCommitsPushCommand(command);
if (recognition !== "pnpm-launch") return;
delete event.input.timeout;
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
| `dotpi/extensions/__tests__/node-parity/zero-timeout-filter.node.ts` | Node extension tests | ✅ |

## Background

Added because agents sometimes set a short shell timeout (e.g. `timeout: 60`)
on the skill invocation. This kills the pipeline mid-flight — retries get
emitted but never consumed, leaving orphaned runs in `.turnlock/`. The filter
makes the timeout stripping automatic so the agent doesn't have to remember.
