# Enhanced Model Selector

- **Date**: 2026-06-27
- **Type**: Extension (replaces built-in `/model` command and `Ctrl+L` shortcut)
- **File**: `~/.pi/agent/extensions/enhanced-model-selector.ts`

## What

Replaces the built-in `/model` command with a richer model selector. Every model is displayed on a single line with emoji-delimited columns:

```
★ claude-sonnet-4-5    💰 $3.00/$15.00  📐 200K  📤 32K   🧠 off,min,low,med,high,xhi  🔑  Anthropic
  gpt-5.2-codex        💰 free/free     📐 400K  📤 128K  🧠 off,min,low,med,high,xhi  🔒  OpenAI Codex
```

| Column | Emoji | Description |
|--------|-------|-------------|
| Model | ★ / ` ` | Model ID, ★ = currently active |
| Cost | 💰 | Input/output cost per 1M tokens (`free` if zero) |
| Context | 📐 | Context window size (K/M formatted) |
| Max output | 📤 | Maximum output tokens |
| Thinking | 🧠 | Supported thinking levels (comma-separated short codes) |
| Auth | 🔑 / 🔒 | 🔑 = API key configured, 🔒 = no key |
| Provider | — | Provider display name |

## Why

The built-in `/model` selector only shows model IDs. This extension adds cost, capacity, thinking-levels, and auth status — all inline — so you can compare models at a glance.

## How It Works

**Three entry points** (because built-in interactive commands like `/model` cannot be overridden by extensions):

1. **`/switch-model`** — A new extension command (no conflict). Registered via `pi.registerCommand("switch-model", ...)`.

2. **`/model` interception** — The `input` event catches `/model` (and `/m`) before the built-in handler, shows the enhanced selector, and returns `{ action: "handled" }` to suppress the built-in.

3. **`Ctrl+L` shortcut** — Registered via `pi.registerShortcut(Key.ctrl("l"), ...)` to replace the built-in model selector keybind.

All three call the same `showSelector()` function which:
- Lists all models via `ctx.modelRegistry.getAll()`
- Groups by provider (alphabetical), auth-configured models first
- Computes max model ID width for column alignment
- Uses `getSupportedThinkingLevels()` from `@earendil-works/pi-ai` for thinking level info
- Displays a `SelectList` with fuzzy-search filter
- On selection, calls `pi.setModel(model)`

## Dependencies

- `@earendil-works/pi-ai` — `getSupportedThinkingLevels`, model types
- `@earendil-works/pi-coding-agent` — `DynamicBorder`, extension types
- `@earendil-works/pi-tui` — `Container`, `Key`, `SelectItem`, `SelectList`, `Text`
