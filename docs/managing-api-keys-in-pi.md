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

OAuth entries are independent of this bridge. Pi creates and refreshes them automatically after `/login`; bridge updates must preserve those entries. Keep both local authentication files at permission mode `0600`.

The legacy flat path `.<provider>.key` remains usable only with a flat central registry. New configurations use the nested provider-and-agent path.

## Relevant Files

- `~/.pi/agent/auth.json`: Pi's local native configuration (contains the `jq` bridge and is not versioned).
- `~/.pi/agent/auth.json.template`: Template for Pi's native configuration (committed).
- `~/.agents/agent-credentials.json`: The global, agnostic source of truth (contains raw Doppler commands).
- `~/.agents/operational-rules/managing-api-keys.md`: The primary documentation for the credential governance architecture.
