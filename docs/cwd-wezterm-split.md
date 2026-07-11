# Cwd WezTerm Split

## Where / What

Global Pi extension that registers `/cwd` and opens a new Pi instance in a
WezTerm split pane or tab without closing the current session.

| What | Where |
| ---- | ----- |
| Extension entry point | `~/.pi/agent/extensions/cwd.ts` |
| Internals | `~/.pi/agent/extensions/cwd-internals/` |
| Tests | `~/.pi/agent/extensions/__tests__/cwd-*.test.ts` |
| Runtime dependency | `wezterm` available on `PATH` |
| User command | `/cwd [--bottom|--top|--right|--left|--horizontal|--vertical|--tab] [path]` |

Defaults:

- `/cwd` with no arguments opens the interactive directory browser.
- The interactive browser starts at `~/Developper/Projects` when that directory
  exists, otherwise it starts at `ctx.cwd`.
- In fast path mode, the split flag defaults to `--bottom`.
- In fast path mode, the path defaults to `.` relative to `ctx.cwd`.
- Flag and path order are both accepted.

## How It Works

The command has two modes:

| Mode | Trigger | Behavior |
| ---- | ------- | -------- |
| Interactive browser | `/cwd` | Opens a keyboard-driven directory browser overlay, then a split type picker overlay. |
| Fast path | `/cwd [flag] [path]` | Parses the raw arguments and opens Pi directly in the requested path/split. |

Both modes eventually verify the selected directory exists, then launch WezTerm
with `execFileSync` and an argv array.

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

## Code Layout

`cwd.ts` is intentionally kept small because Pi auto-discovers top-level
extension files. The implementation lives in `cwd-internals/` so adding a
directory-style `cwd/index.ts` cannot accidentally register `/cwd` twice.

| File | Responsibility |
| ---- | -------------- |
| `extensions/cwd.ts` | Pi command registration and public re-exports |
| `extensions/cwd-internals/types.ts` | Shared command, dependency, and split types |
| `extensions/cwd-internals/args.ts` | Raw argument tokenizing and parsing |
| `extensions/cwd-internals/wezterm.ts` | WezTerm argv construction, directory checks, default dependencies |
| `extensions/cwd-internals/directory-browser.ts` | Interactive folder browser component |
| `extensions/cwd-internals/split-picker.ts` | Interactive split type picker component |
| `extensions/cwd-internals/interactive.ts` | No-argument interactive `/cwd` flow |
| `extensions/cwd-internals/handler.ts` | Fast path and interactive command orchestration |

## Interactive Directory Browser

Type `/cwd` with no arguments to open the interactive browser. It starts at
`~/Developper/Projects` when that directory exists, and falls back to Pi's
current working directory otherwise.

Flow:

1. Directory browser overlay opens at `~/Developper/Projects` when available,
   otherwise at `ctx.cwd`.
2. Choose `📂 Use this directory` to confirm the displayed directory, or enter a
   subdirectory.
3. Split type overlay opens.
4. Choose a split type to spawn a new Pi instance in WezTerm.

Directory browser behavior:

| Key | Action |
| --- | ------ |
| `↑` / `↓` | Move selection. |
| `Enter` | Confirm current item. |
| `Backspace` | Go to parent directory. |
| `←` | Go to parent directory. |
| `Home` | Jump to first item. |
| `End` | Jump to last item. |
| `Esc` | Cancel. |

Only subdirectories are shown. Dot directories are hidden to reduce noise.

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
| `~/.pi/agent/extensions/cwd.ts` | Pi `/cwd` command entrypoint | Yes |
| `~/.pi/agent/extensions/cwd-internals/` | Parser, WezTerm, browser, picker, interactive, and handler modules | Yes |
| `~/.pi/agent/extensions/__tests__/cwd-*.test.ts` | Parser, argv builder, browser, handler, interactive, and registration tests | Yes |
| `~/.local/bin/wezterm` | User-local symlink to the WezTerm app bundle CLI | No |
| `~/.pi/agent/docs/cwd-wezterm-split.md` | This documentation | Yes |

## Background

Added to make it fast to fork work into a fresh Pi instance from the current
session. The extension uses WezTerm panes/tabs instead of replacing or shutting
down the active Pi session.
