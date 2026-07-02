# Git Commits Push Enforcer

- **Date**: 2026-06-28
- **Type**: Extension (no patch needed)
- **File**: `~/.pi/agent/extensions/git-commits-push-enforcer.ts`

## What

Forces the agent to use `/git-commits-push` instead of bare `git commit`. Blocks
any `git commit -m "..."` that doesn't both:

1. Follow Conventional Commits format (`<type>(<scope>): <description>`)
2. Include a push in the same command (`&& git push`)

## How It Works

Listens to `tool_call` → `bash` containing `git commit`:

- Extracts the message from `-m "..."`, `-m '...'`, or heredoc
- If no `-m` → allows (interactive editor)
- If message doesn't match CC regex → blocks with reminder to use `/git-commits-push`
- If no `git push` in the command → blocks (skill mandates auto-push)

## Shared Logic

Mirrors `~/.agents/agent-hooks/git-commits-push-enforcer/src/bin/pre-tool-use.ts`.
Same logic, same regex, same behavior across all harnesses.

## Relevant Files

| File | Purpose | Versioned |
|------|---------|-----------|
| `dotpi/extensions/git-commits-push-enforcer.ts` | Pi extension | ✅ |
| `dotagents/agent-hooks/git-commits-push-enforcer/` | Shared hook logic | ✅ |
