# Permission Enforcer

- **Date**: 2026-07-09
- **Type**: Extension
- **File**: `~/.pi/agent/extensions/permission-enforcer.ts`

## What

Updates the shared `/go` permission state before each Pi agent run.

The extension exists so `command-validator` can focus on tool decisions while
`permission-enforcer` owns prompt-to-state lifecycle.

## How It Works

The extension listens to `before_agent_start`.

For every prompt, it calls the shared state core:

```text
~/.agents/agent-enforcers/permission-enforcer/src/core/state.ts
```

The state core grants permission when the prompt contains either form:

- `/go`
- `<skill name="go">`

Any prompt without those markers resets permission to denied.

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
- `promptLength`

The event does not store prompt content.

## Relevant Files

- `~/.pi/agent/extensions/permission-enforcer.ts`
- `~/.pi/agent/extensions/__tests__/permission-enforcer.test.ts`
- `~/.pi/agent/extensions/__tests__/permission-enforcer.integration.test.ts`
- `~/.pi/agent/extensions/__tests__/permission-enforcer.contract.test.ts`
- `~/.pi/agent/extensions/__tests__/permission-enforcer.e2e.test.ts`
- `~/.agents/agent-enforcers/permission-enforcer/src/core/state.ts`
- `~/.agents/docs/permission-enforcer.md`
