# Permission Enforcer

- **Date**: 2026-07-09
- **Type**: Extension
- **File**: `~/.pi/agent/extensions/permission-enforcer.ts`

## What

Updates Pi's session-scoped `/go` permission state before each Pi agent run.

The extension exists so `command-validator` can focus on tool decisions while
`permission-enforcer` owns prompt-to-state lifecycle.

## How It Works

The extension listens to `before_agent_start`.

For every prompt, it derives the real Pi session id from
`ctx.sessionManager.getSessionId()` and calls the shared state core:

```text
~/.agents/agent-enforcers/permission-enforcer/src/core/state.ts
```

The scope key is:

```text
pi:<session-id>
```

The state core grants permission when the prompt contains either form:

- `/go`
- `<skill name="go">`

Any prompt without those markers resets permission to denied for the current Pi
session only. Other active Pi sessions keep their own permission state.

## Telemetry

Events are written to:

```text
~/neelopedia/stats/pi/permission-enforcer/events.jsonl
```

Event type:

```text
permission_state_change
```

Details include:

- `granted`
- `parentModel`
- `thinkingLevel`
- `matchSource`
- `permissionScope`
- `promptLength`

The event does not store prompt content.

## Relevant Files

- `~/.pi/agent/extensions/permission-enforcer.ts`
- `~/.pi/agent/extensions/shared/pi-permission-scope.ts`
- `~/.pi/agent/extensions/__tests__/permission-enforcer.test.ts`
- `~/.pi/agent/extensions/__tests__/permission-enforcer.integration.test.ts`
- `~/.pi/agent/extensions/__tests__/permission-enforcer.contract.test.ts`
- `~/.pi/agent/extensions/__tests__/permission-enforcer.e2e.test.ts`
- `~/.agents/agent-enforcers/permission-enforcer/src/core/state.ts`
- `~/.agents/docs/permission-enforcer.md`
