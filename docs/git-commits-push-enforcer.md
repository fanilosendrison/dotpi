# Git Commits Push Enforcer

- **Date**: 2026-07-05
- **Type**: Extension (no patch needed)
- **File**: `~/.pi/agent/extensions/git-commits-push-enforcer.ts`

## What

Intercepts every commit intent (raw `git commit` or skill invocation) and routes
it through the `/git-commits-push` skill. Logs one `enforcer_triggered` event per
interception in `~/neelopedia/stats/pi/git-commits-push-enforcer/events.jsonl`.

Does **not** validate or block anything — the skill handles that.

## How It Works

Listens to `tool_call` → `bash`. If the command matches a commit intent pattern,
it sets `PI_PARENT_MODEL` and `PI_SESSION_ID` env vars, then logs the event.

Detection patterns:
- `git commit` — raw git commit (regex `git\s+commit\b`)
- `/git-commits-push` — skill command (regex `\/git-commits-push(?:\s|$)`)
- `.agents/skills/git-commits-push` — skill launch path

## Stats

One event per trigger:

```json
{
  "eventType": "enforcer_triggered",
  "details": {
    "rawCommand": "git commit -m 'feat: x'",
    "detectedBy": "git-commit",
    "toolCallId": "call_00_...",
    "parentModel": "deepseek-v4-flash",
    "thinkingLevel": "xhigh"
  }
}
```

## Relevant Files

| File | Purpose | Versioned |
|------|---------|-----------|
| `dotpi/extensions/git-commits-push-enforcer.ts` | Pi extension | ✅ |
| `dotpi/extensions/git-commits-push-enforcer-internals/stats-log.ts` | Stats logging module | ✅ |
| `dotpi/extensions/__tests__/git-commits-push-enforcer.test.ts` | Extension tests | ✅ |
| `dotpi/extensions/git-commits-push-enforcer-internals/__tests__/stats-log.test.ts` | Stats-log tests | ✅ |
