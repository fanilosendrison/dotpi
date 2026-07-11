# Cwd WezTerm Split

## Where / What

Global Pi extension that registers `/cwd` and opens a new Pi instance in a
WezTerm split pane or tab without closing the current session.

| What | Where |
| ---- | ----- |
| Extension entry point | `~/.pi/agent/extensions/cwd.ts` |
| Tests | `~/.pi/agent/extensions/__tests__/cwd.test.ts` |
| Runtime dependency | `wezterm` available on `PATH` |
| User command | `/cwd [--bottom|--top|--right|--left|--horizontal|--vertical|--tab] [path]` |

Defaults:

- Split flag defaults to `--bottom`.
- Path defaults to `.` relative to `ctx.cwd`.
- Flag and path order are both accepted.

## How It Works

The command parses the raw slash-command argument string, resolves the target
directory relative to Pi's current working directory, verifies that the
directory exists, then launches WezTerm with `execFileSync` and an argv array.

```typescript
execFileSync(
	"wezterm",
	["cli", "split-pane", "--bottom", "--cwd", directory, "--", "pi"],
	{ stdio: "ignore" },
);
```

Command mapping:

| User Flag | WezTerm Args |
| --------- | ------------ |
| `--bottom` | `cli split-pane --bottom --cwd <dir> -- pi` |
| `--top` | `cli split-pane --top --cwd <dir> -- pi` |
| `--right` | `cli split-pane --right --cwd <dir> -- pi` |
| `--left` | `cli split-pane --left --cwd <dir> -- pi` |
| `--horizontal` | `cli split-pane --horizontal --cwd <dir> -- pi` |
| `--vertical` | `cli split-pane --bottom --cwd <dir> -- pi` |
| `--tab` | `cli spawn --cwd <dir> -- pi` |

The `--vertical` user flag is intentionally translated to `--bottom` because
the installed WezTerm CLI rejects `--vertical`; WezTerm expresses vertical
top/bottom splits through `--top` and `--bottom`.

Error behavior:

| Condition | Notification |
| --------- | ------------ |
| Invalid split flag | `Invalid split type. Use: --bottom, --top, --right, --left, --horizontal, --vertical, --tab` |
| Missing directory | `Directory not found: <dir>` |
| WezTerm execution failure | `wezterm CLI not available. Are you inside WezTerm?` |
| Success | `Pi opened in split pane: <dir>` |

## Relevant Files

| File | Purpose | Versioned |
| ---- | ------- | --------- |
| `~/.pi/agent/extensions/cwd.ts` | Pi `/cwd` command implementation | Yes |
| `~/.pi/agent/extensions/__tests__/cwd.test.ts` | Parser, argv builder, handler, and registration tests | Yes |
| `~/.local/bin/wezterm` | User-local symlink to the WezTerm app bundle CLI | No |
| `~/.pi/agent/docs/cwd-wezterm-split.md` | This documentation | Yes |

## Background

Added to make it fast to fork work into a fresh Pi instance from the current
session. The extension uses WezTerm panes/tabs instead of replacing or shutting
down the active Pi session.
