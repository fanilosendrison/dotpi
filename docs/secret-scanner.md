# Secret Scanner

- **Date**: 2026-07-05
- **Type**: Extension
- **File**: `~/.pi/agent/extensions/secret-scanner.ts`

## What

Intercepts `git commit` commands and scans the staged diff for secrets,
API keys, tokens, and passwords. Blocks the commit if any are found.

## How It Works

Listens to `tool_call` → `bash` containing `git commit`. Runs `git diff --cached`
and passes the output to the shared scanner logic.

- If the diff is clean → logs `scan_result{status: "clean"}` and lets the commit pass
- If secrets are detected → logs `scan_result{status: "blocked"}` with findings and blocks

## Stats

One event per scan in `~/neelopedia/stats/pi/secret-scanner/events.jsonl`:

```json
{
  "eventType": "scan_result",
  "details": {
    "status": "clean",
    "parentModel": "deepseek-v4-flash",
    "thinkingLevel": "xhigh"
  }
}
```

On block:

```json
{
  "eventType": "scan_result",
  "details": {
    "status": "blocked",
    "findingsCount": 2,
    "findings": [
      { "name": "AWS Access Key", "line": "AKIA...", "lineNumber": 12 }
    ],
    "parentModel": "deepseek-v4-flash",
    "thinkingLevel": "xhigh"
  }
}
```

## Shared Logic

The detection logic lives in `~/.agents/agent-enforcers/secret-scanner/src/core/scanner.ts`.
It scans the diff against regex patterns (AWS keys, GitHub tokens, connection strings,
generic secrets).

## Relevant Files

| File | Purpose | Versioned |
|------|---------|-----------|
| `dotpi/extensions/secret-scanner.ts` | Pi extension | ✅ |
| `dotpi/extensions/__tests__/secret-scanner.test.ts` | Extension tests | ✅ |
