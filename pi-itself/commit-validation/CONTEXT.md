# Commit Validation Extensions

- **Date**: 2026-06-28
- **Type**: Extensions (no patch needed)
- **Files**:
  - `~/.pi/agent/extensions/secret-scanner.ts`
  - `~/.pi/agent/extensions/commit-validator.ts`

## What

Two extensions that enforce commit quality before every `git commit` in Pi:

- **secret-scanner** — scans the staged diff and blocks the commit if it contains
  secrets, API keys, tokens, or passwords
- **commit-validator** — validates the commit message against Conventional Commits
  1.0.0 and blocks if the format is invalid

## How It Works

Both listen to the `tool_call` event, intercept `bash` calls containing `git commit`:

- **secret-scanner** runs `git diff --cached`, scans added lines against regex patterns
  (AWS keys, GitHub tokens, connection strings, generic secrets), and blocks with
  `{ block: true }` if any are found. False positives (env var references, placeholders)
  are filtered out.
- **commit-validator** extracts the message from `-m "..."` or heredoc syntax, validates
  it against Conventional Commits rules (type, casing, length, tense, vagueness), and
  blocks if invalid.

## Shared Logic

The detection logic is identical to the harness-agnostic hooks in
`~/.agents/agent-hooks/secret-scanner/` and `~/.agents/agent-hooks/commit-msg-validator/`.
If the patterns are updated there, the extensions should be updated to match.

## Relevant Files

| File | Purpose | Versioned |
|------|---------|-----------|
| `dotpi/extensions/secret-scanner.ts` | Pi extension for secret detection | ✅ |
| `dotpi/extensions/commit-validator.ts` | Pi extension for commit message validation | ✅ |
| `dotagents/agent-hooks/secret-scanner/src/core/scanner.ts` | Shared detection logic | ✅ |
| `dotagents/agent-hooks/commit-msg-validator/src/core/validator.ts` | Shared validation logic | ✅ |
