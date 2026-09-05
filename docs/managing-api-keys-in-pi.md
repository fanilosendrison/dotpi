# Managing API Keys in Pi (Agnostic Bridge)

## Overview

Pi natively expects its authentication configuration at `~/.pi/agent/auth.json`. The global `.agents` governance strategy centralizes API key retrieval commands in `~/.agents/agent-credentials.json`.

The central registry groups commands by provider and agent identity. Pi's local authentication file selects the identity that Pi uses for each provider without duplicating the Doppler command.

## The `jq` Bridge

Pi executes the value of an API key entry as a shell command when that value starts with an exclamation mark (`!`). The `auth.json` bridge uses this behavior with command substitution and `jq`:

```json
{
  "<provider-slug>": {
    "type": "api_key",
    "key": "!$(jq -r '.[\"<provider-slug>\"][\"<agent-id>\"].key' ~/.agents/agent-credentials.json)"
  }
}
```

Bracket notation keeps provider and agent identifiers valid when they contain characters such as hyphens.

### How It Executes

1. Pi reads `auth.json`.
2. Pi detects the `!` prefix, removes it, and passes the remaining value to the system shell.
3. The shell evaluates the `$(jq ...)` command substitution.
4. `jq` reads `~/.agents/agent-credentials.json` and selects the command at the configured provider and agent path.
5. The shell executes the selected Doppler command.
6. Doppler writes the API key to standard output, which Pi captures and caches for the process lifetime.

## Agent Selection

Pi has one authentication entry per provider, so every bridge must select one explicit `<agent-id>`. Other tools can select different identities under the same provider without changing Pi's configuration.

## OAuth vs API Key Credentials

**Important distinction**: The jq bridge architecture described above is **only for API-key based providers** (e.g., `anthropic`, `deepseek`, `openai` API-key provider).

**OAuth-based providers** (e.g., `openai-codex`, `github-copilot`) use Pi's native OAuth flow and are stored directly in `auth.json` without the jq bridge. This includes:

- Native `openai-codex` provider
- Pi multi-login aliases (e.g., `openai-codex-2`, `openai-codex-work`)

### OAuth Architecture

OAuth credentials for Codex subscriptions are managed entirely by Pi:

```
~/.pi/agent/auth.json
    ├── openai-codex          (subscription A - native)
    ├── openai-codex-2        (subscription B - pi-multi-login alias)
    └── openai-codex-work     (subscription C - pi-multi-login alias)
```

Each alias is a separate provider ID with its own OAuth credential slot. The pi-multi-login package registers these aliases and Pi's `/login` command handles authentication for each.

### API Key Architecture

API keys are managed through the Doppler bridge:

```
~/.agents/agent-credentials.json
    ├── anthropic
    │   └── review-agent → doppler secrets get ANTHROPIC_API_KEY_REVIEW_AGENT ...
    ├── deepseek
    │   └── default → doppler secrets get DEEPSEEK_API_KEY_DEFAULT ...
    └── openai
        └── release-agent → doppler secrets get OPENAI_API_KEY_RELEASE_AGENT ...

~/.pi/agent/auth.json
    ├── anthropic
    │   └── type: "api_key", key: "!$(jq -r ...)"
    ├── deepseek
    │   └── type: "api_key", key: "!$(jq -r ...)"
    └── openai
        └── type: "api_key", key: "!$(jq -r ...)"
```

## Summary

| Credential Type | Storage | Management |
|----------------|---------|------------|
| API keys | Doppler + `agent-credentials.json` + jq bridge | `.agents` governance |
| OAuth (Codex) | `auth.json` (Pi native) | Pi `/login` + pi-multi-login |

**Never** store OAuth tokens in Doppler or `agent-credentials.json`. OAuth credentials remain Pi-local in `auth.json`.

OAuth entries are independent of the jq bridge. Pi creates and refreshes them automatically after `/login`; bridge updates must preserve those entries. Keep both local authentication files at permission mode `0600`.

The legacy flat path `.<provider>.key` remains usable only with a flat central registry. New configurations use the nested provider-and-agent path.

## Relevant Files

- `~/.pi/agent/auth.json`: Pi's local native configuration (contains the `jq` bridge and OAuth credentials; is not versioned).
- `~/.pi/agent/auth.json.template`: Template for Pi's native configuration (committed).
- `~/.pi/agent/pi-multi-login.json`: Configuration for pi-multi-login aliases (committed).
- `~/.agents/agent-credentials.json`: The global, agnostic source of truth (contains raw Doppler commands).
- `~/.agents/operational-rules/managing-api-keys.md`: The primary documentation for the credential governance architecture.
