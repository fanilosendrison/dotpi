# Git Commits Push Enforcer

- **Date**: 2026-07-10
- **Type**: Extension
- **File**: `~/.pi/agent/extensions/git-commits-push-enforcer.ts`

## What

Blocks direct raw Git mutations in Pi and forces commits through the `/git-commits-push` skill.

This extension does **not** validate Conventional Commit text. Commit-message validation, file splitting, tests, secret scanning, commit execution, and push retry logic belong to the `/git-commits-push` skill.

## Blocked Commands

The extension blocks these direct Bash commands unless `BYPASS_GIT_ENFORCER=1` is already present in the Pi process environment:

- `git commit`
- `git commit-tree`
- `git push`

The normal allowed path is:

```bash
/git-commits-push
```

The direct skill launch path is also allowed:

```bash
cd ~/.agents/skills/git-commits-push && bun run start
```

## How It Works

The extension listens to `tool_call` events and only inspects Bash commands.

When it detects a `/git-commits-push` invocation, it sets:

- `PI_PARENT_MODEL`
- `PI_SESSION_ID`

Then it writes an `enforcer_triggered` telemetry event and allows the command.

When it detects a direct raw Git mutation, it writes a `blocked` telemetry event and returns a Pi block response:

```text
Direct git commits are blocked. Use /git-commits-push instead.
```

When `BYPASS_GIT_ENFORCER=1` is present in the Pi process environment, it writes a `skipped` event and allows the command. That bypass is intended for trusted internal execution, not ad hoc agent commands.

## Telemetry

Events are written to:

```text
~/neelopedia/stats/pi/git-commits-push-enforcer/events.jsonl
```

Current event types:

- `enforcer_triggered`: the `/git-commits-push` skill path was invoked.
- `blocked`: a direct raw Git mutation was denied.
- `skipped`: a raw Git mutation was allowed because the process-level bypass was active.

Common details:

```json
{
  "rawCommand": "git commit -m 'feat: x'",
  "detectedBy": "git-commit",
  "toolCallId": "call_00_...",
  "parentModel": "deepseek-v4-flash",
  "thinkingLevel": "xhigh",
  "mutation": "commit"
}
```

For skill invocations, `detectedBy` is `git-commits-push` and no `mutation` field is emitted.

## Relevant Files

| File | Purpose | Versioned |
|------|---------|-----------|
| `dotpi/extensions/git-commits-push-enforcer.ts` | Pi extension | ✅ |
| `dotpi/extensions/__tests__/git-commits-push-enforcer.test.ts` | Extension regression tests | ✅ |
| `dotpi/extensions/__tests__/git-commits-push-enforcer.integration.test.ts` | Real handler and telemetry integration tests | ✅ |
