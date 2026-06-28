# Path Guard

- **Date**: 2026-06-28
- **Type**: Extension
- **File**: `~/.pi/agent/extensions/path-guard.ts`

## What

Blocks `Write` and `Edit` tool calls that target files directly under
`~/Developper/Projects/dotpi/` instead of through `~/.pi/agent/`.

When blocked, the error message shows the equivalent `~/.pi/agent/` path to use.

## Why

The harness rule is: **always write through `~/.pi/agent/`, never directly to `dotpi/`**.
The agent kept violating it because nothing enforced it mechanically. This extension
closes that gap.

## How It Works

1. Intercepts `tool_call` for `write` and `edit`
2. Resolves the target path to its real path (following symlinks)
3. If the real path is inside `dotpi/` but the given path does not start with
   `~/.pi/agent/`, the operation is blocked
4. The block message includes the correct `~/.pi/agent/` path to use instead
