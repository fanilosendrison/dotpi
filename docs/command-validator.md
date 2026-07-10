# Command Validator

- **Date**: 2026-06-28
- **Updated**: 2026-07-09
- **Type**: Extension
- **File**: `~/.pi/agent/extensions/command-validator.ts`

## What

Validates Pi tool calls against the shared command-validator rules.

The extension blocks forbidden bash commands, asks for confirmation on dangerous
bash commands, and consumes `/go` permission state for restricted modifying
tools.

Its runtime-facing contract is shared with the Codex hook through:

```text
~/.agents/agent-enforcers/command-validator/src/core/runtime-contract.ts
```

## How It Works

The extension listens to `tool_call`.

For bash calls, it validates the command string through:

```text
~/.agents/agent-enforcers/command-validator/src/core/validator.ts
```

For restricted modifying tools, the shared validator delegates to:

```text
~/.agents/agent-enforcers/command-validator/src/core/tool-validator.ts
```

That validator calls `isPermissionGranted()` from:

```text
~/.agents/agent-enforcers/permission-enforcer/src/core/state.ts
```

The command-validator extension no longer updates permission state. Prompt
lifecycle is owned by `~/.pi/agent/extensions/permission-enforcer.ts`.

Telemetry details, reason formatting, command truncation, severity inclusion, and
restricted-tool target detection are normalized by the shared runtime contract.
Pi remains responsible for its platform-specific approval UI through
`ctx.ui.confirm`.

## Decisions

| Level | Behavior |
|-----|--------|
| `rm -rf` | Blocked unconditionally. |
| Destructive patterns | Blocked unconditionally. |
| Dangerous commands | User confirmation required. |
| `chmod +x` | Allowed. |
| Safe bash commands | Allowed silently. |
| Restricted tool without `/go` | Blocked with the permission authorization message. |
| Restricted tool with `/go` | Allowed. |

## Telemetry

Events are written to:

```text
~/neelopedia/stats/pi/command-validator/events.jsonl
```

Event type:

```text
validation_result
```

## Relevant Files

- `~/.pi/agent/extensions/command-validator.ts`
- `~/.pi/agent/extensions/permission-enforcer.ts`
- `~/.agents/agent-enforcers/command-validator/`
- `~/.agents/agent-enforcers/permission-enforcer/src/core/state.ts`
