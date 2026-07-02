# Managing API Keys in Pi (Agnostic Bridge)

## Overview

Pi natively expects its authentication configuration to be located at `~/.pi/agent/auth.json`. 
However, as part of the global `.agents` governance strategy, the actual source of truth for all API keys (and their associated Doppler retrieval commands) has been centralized into an agnostic registry: `~/.agents/agent-credentials.json`.

This document explains how Pi's internal configuration is bridged to read from this global registry.

## The `jq` Bridge

Pi has a built-in feature where it can dynamically execute a command to retrieve an API key if the value in `auth.json` starts with an exclamation mark (`!`).

To avoid duplicating Doppler commands and to maintain a single source of truth, Pi's `auth.json` leverages this `!command` feature alongside a subshell `$(...)` and `jq` to parse the central registry:

```json
{
  "<provider-slug>": {
    "type": "api_key",
    "key": "!$(jq -r '.<provider-slug>.key' ~/.agents/agent-credentials.json)"
  }
}
```

### How It Executes
1. Pi reads `auth.json`.
2. It sees the `!` prefix, strips it, and passes the remainder to the system shell.
3. The shell evaluates the `$(jq ...)` subshell.
4. `jq` parses `~/.agents/agent-credentials.json` and extracts the raw Doppler command for that specific provider.
5. The subshell output (the Doppler command) replaces the `$()` block, and the shell executes it.
6. Doppler fetches the token securely and outputs it to stdout, which Pi captures and uses.

## Relevant Files

- `~/.pi/agent/auth.json`: Pi's native configuration (contains the `jq` bridge, gitignored).
- `~/.pi/agent/auth.json.template`: Template for Pi's native configuration (committed).
- `~/.agents/agent-credentials.json`: The global, agnostic source of truth (contains raw Doppler commands).
- `~/.agents/operational-rules/managing-api-keys.md`: The primary documentation for the credential governance architecture.
