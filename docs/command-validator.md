# Command Validator

- **Date**: 2026-06-28
- **Type**: Extension (no patch needed)
- **File**: `~/.pi/agent/extensions/command-validator.ts`

## What

Security guard for bash commands. Intercepts every `bash` tool call and blocks
or confirms dangerous operations.

## How It Works

Listens to `tool_call` → `bash`:

| Level | Behavior |
|-------|----------|
| `rm -rf` | Blocked unconditionally |
| Destructive patterns (`dd of=/dev/`, `curl \| sh`, fork bomb, `cat /etc/passwd`, etc.) | Blocked unconditionally |
| Dangerous commands (`sudo`, `kill`, `chmod`, `nc`, `mount`, etc.) | User confirmation required |
| `chmod +x` | Allowed (making scripts executable) |
| Everything else | Silently allowed |

## Shared Logic

Mirrors `~/.agents/agent-hooks/command-validator/src/core/validator.ts`.
The dangerous commands list and destructive patterns are kept in sync.

## Relevant Files

| File | Purpose | Versioned |
|------|---------|-----------|
| `dotpi/extensions/command-validator.ts` | Pi extension | ✅ |
| `dotagents/agent-hooks/command-validator/` | Shared security rules | ✅ |
