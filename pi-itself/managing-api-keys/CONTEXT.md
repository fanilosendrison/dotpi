# Managing API Keys

## Where Keys Live

API keys live **only** in Doppler. Nothing else stores the actual secret value — not `auth.json`, not env vars, not shell profiles.

| What | Where |
|------|-------|
| All API keys | Doppler, project `<agent_name>`, config `<config>` |


---


## How It Works

`!command` syntax in `auth.json`:

```json
{
  "<provider-slug>": {
    "type": "api_key",
    "key": "!doppler secrets get <PROVIDER>_API_KEY_<AGENT_NAME> -p <agent-name> -c <config> --plain"
  }
}
```

The command is executed on every request. `stdout` = the API key. No caching (by design — wrap in a script if needed).

### Naming Convention
```
<PROVIDER>_API_KEY_<AGENT_NAME>
```

All uppercase. Components:
- **`<PROVIDER>`** : provider name (e.g. `DEEPSEEK`, `ANTHROPIC`, `OPENAI`)
- **`_API_KEY_`** : fixed separator
- **`<AGENT_NAME>`** : name of the pi agent that uses the key (e.g. `JANET`, `MARCUS`)

Examples:
```
DEEPSEEK_API_KEY_JANET    ← agent Janet
ANTHROPIC_API_KEY_JANET   ← agent Janet
OPENAI_API_KEY_MARCUS     ← agent Marcus
```

### Placeholders Reference
| Placeholder | Meaning | Example |
|-------------|---------|---------|
| `<provider-slug>` | Lowercase provider ID in pi | `deepseek`, `anthropic` |
| `<PROVIDER>` | Uppercase provider name | `DEEPSEEK`, `ANTHROPIC` |
| `<AGENT_NAME>` | Uppercase agent name | `JANET` |
| `<agent-name>` | Lowercase agent name (matches Doppler project) | `janet` |
| `<config>` | Doppler config | `<config>` |


---


## Relevant Files

| File | Purpose | Versioned |
|------|---------|-----------|
| `~/.pi/agent/auth.json` | `!command` to fetch keys from Doppler | ❌ gitignored |
| `~/.pi/agent/auth.json.example` | Template for `auth.json` with placeholders | ✅ committed |
| `~/.pi/agent/settings.json` | Default provider/model/thinking level | ✅ committed |


---


## Background

Pi's auth system was changed to resolve credentials dynamically via Doppler instead of hardcoded API keys or env vars.

- No API key stored in plain text anywhere in the config
- No shell alias needed (`doppler run`)
- Entire auth config lives in `~/.pi/agent/` — one repo, no shell dotfiles dependency
