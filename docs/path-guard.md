# Path Guard

- **Date**: 2026-07-05
- **Type**: Extension
- **File**: `~/.pi/agent/extensions/path-guard.ts`
- **Core**: `~/Developper/Projects/dotagents/agent-enforcers/path-guard/src/core/path-guard.ts`

## What

Intercepts and transparently rewrites `Write`, `Edit`, and `Bash` tool calls that target any `dot*` repo under
`~/Developper/Projects/` (dotpi, dotagents, dotclaude, etc.) instead of through
their `~/.` prefix gateway.

For dotpi specifically: writes directed at `dotpi/` are silently rewritten to `~/.pi/agent/`.
Git commits must still be done through `cd ~/Developper/Projects/dotpi && git ...`.

Instead of blocking the agent with an error, the extension now acts as a "verbose wrapper":
- It mutates the target path on the fly to its safe `~/.` gateway.
- For bash commands, it prepends a `[Path-Guard] 🔄 Redirection silencieuse...` warning to `stderr` so the agent is aware, but allows the command to succeed.

Stats: logs a `path_access` event per dot* access in
`~/neelopedia/stats/pi/path-guard/events.jsonl`, with `action: "redirected"`
or `action: "correct"` for the ratio.

## Why

The harness rule is: **always write through `~/.pi/agent/`, never directly to `dotpi/`**.
The agent kept violating it because nothing enforced it mechanically. This extension
originally blocked those writes, but now transparently redirects them to prevent
friction and wasted iterations while maintaining the exact same security guarantees.

## How It Works

### Architecture

The extension (`extensions/path-guard.ts`) is a thin Pi hook. All logic lives
in the shared core at `dotagents/agent-enforcers/path-guard/src/core/path-guard.ts`,
reusable by other agent harnesses.

### Path resolution

1. `checkPath(givenPath)` resolves the given path to its real path (following
   symlinks, walking up ancestors for non-existent files)
2. Expands `~` and `~/...` to the home directory
3. If the real path is inside `~/Developper/Projects/dot<name>/` but the given
   path does not start with the gateway (`~/.pi/agent/` for dotpi,
   `~/.agents/` for dotagents, etc.), the operation is blocked

### Write / Edit guard

Intercepts `tool_call` for `write` and `edit`. Reads the target path from
`event.input.file_path ?? event.input.path` (tools use different parameter names).

### Bash guard

1. Intercepts `tool_call` for `bash`
2. Unwraps command wrappers: `env -i`, `sudo`, `nohup`, `bash -c '...'`,
   `sh -c '...'`, `zsh -c`, `dash -c`, `$SHELL -c`
3. Extracts candidate file paths from the unwrapped command:
   - Absolute paths (`/...`)
   - Tilde paths (`~/...`)
   - Relative paths containing `/` (e.g. `../../Developper/Projects/dotpi/.pi`)
   - Redirect targets (`>`, `>>`, `2>`, `&>`)
   - Tee targets (`tee`, `tee -a`)
   - Skips flags (tokens starting with `-` even if they contain `/`)
   - Skips paths inside single/double quotes
4. Checks each candidate path via `checkPath`
5. Uses `rewriteBashCommand` to mutate the bash command, replacing any forbidden path with its `~/.` gateway path.
6. Prepends an `echo` warning to `stderr` if any rewrite occurred.

### Git whitelist

Commands composed entirely of `cd` and `git` segments (separated by `&&` or `;`)
are whitelisted — they can operate directly inside `dot*` repos. This is the
whole reason these repos exist.

### Supported dot* repos

Any directory under `~/Developper/Projects/` whose name starts with `dot` is
automatically protected. The gateway is derived as `~/.<name>/` (e.g. `dotpi` →
`~/.pi/`, `dotagents` → `~/.agents/`). dotpi is special-cased to use
`~/.pi/agent/` as its gateway.

## Stats

One event per dot* access:

```json
{
  "eventType": "path_access",
  "details": {
    "action": "redirected",
    "toolType": "bash",
    "repo": "dotpi",
    "parentModel": "deepseek-v4-flash",
    "thinkingLevel": "xhigh"
  }
}
```

Both `redirected` and `correct` actions are logged for the ratio.
