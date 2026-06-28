# Extended Global Context

- **Date**: 2026-06-28
- **Type**: Extension (no patch needed)
- **File**: `~/.pi/agent/extensions/extended-global-context.ts`

## What

Injects the content of `~/.agents/AGENTS.md` into Pi's `<project_context>` section of the system prompt. The shared conventions live in `dotagents/AGENTS.md` (git-tracked) and are available in every Pi session, regardless of the working directory.

## How It Works

The extension hooks into `before_agent_start`:

1. Reads `~/.agents/AGENTS.md` once per session (cached)
2. Wraps it in `<project_instructions path="...">`
3. Injects it inside `<project_context>`, alongside other AGENTS.md files

If `<project_context>` doesn't exist yet, it creates the section.

The cache is flushed on `session_start` so `/reload` picks up changes.

## Relevant Files

| File | Purpose | Versioned |
|------|---------|-----------|
| `dotpi/extensions/extended-global-context.ts` | Extension source | ✅ |
| `dotagents/AGENTS.md` | Content injected into context | ✅ |
