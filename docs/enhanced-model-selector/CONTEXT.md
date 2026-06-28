# Enhanced Model Selector

- **Date**: 2026-06-27 (updated 2026-06-28)
- **Type**: Extension + pi dist patch (enables `/model` to trigger the enhanced selector)
- **Files**:
  - Extension: `~/.pi/agent/extensions/enhanced-model-selector.ts`
  - Git-tracked patch: [`interactive-mode.patch`](interactive-mode.patch)
  - Apply script: [`../../patches/enhanced-model-selector/apply.sh`](../../patches/enhanced-model-selector/apply.sh)
  - Revert script: [`../../patches/enhanced-model-selector/revert.sh`](../../patches/enhanced-model-selector/revert.sh)

## Quick Reference

- **Trigger**: `/model` or `Ctrl+Shift+L`
- **After `pi update`**: run `./patches/enhanced-model-selector/apply.sh`
- **Main file**: `~/.pi/agent/extensions/enhanced-model-selector.ts`
- **Revert patch**: `./patches/enhanced-model-selector/revert.sh`

---

## What

Adds a richer model selector. Every model is displayed on a single line with emoji-delimited columns:

```
★ claude-sonnet-4-5    💰 $3.00/$15.00  📐 200K  📤 32K   🧠 off,min,low,med,high,xhi  🔑  Anthropic
  glm-4.7              💰 ?/?           📐 128K  📤 16K   🧠 —                       🔒  Z.AI
```

| Column | Emoji | Description |
|--------|-------|-------------|
| Model | ★ / ` ` | Model ID, ★ = currently active |
| Cost | 💰 | Input/output cost per 1M tokens (`?` if unknown) |
| Context | 📐 | Context window size (K/M formatted) |
| Max output | 📤 | Maximum output tokens |
| Thinking | 🧠 | Supported thinking levels (comma-separated short codes) |
| Auth | 🔑 / 🔒 | 🔑 = API key configured, 🔒 = no key |
| Provider | — | Provider display name |

---

## Why

The built-in `/model` selector only shows model IDs. This extension adds cost, capacity, thinking-levels, and auth status — all inline — so you can compare models at a glance.

---

## Architecture

**Two components** work together:

1. **Extension** (`enhanced-model-selector.ts`) — registers a `Ctrl+Shift+L` shortcut and an `input` event handler that intercepts `/model`. Renders the `SelectList` UI with all model metadata.

2. **Dist patch** (`interactive-mode.patch`) — Pi's built-in `/model` handler is hardcoded in `dist/modes/interactive/interactive-mode.js` and runs *before* any extension events can fire. The patch comments out that handler so `/model` falls through to `session.prompt()` → our extension's `input` event.

### Why the patch is unavoidable

```js
// dist/modes/interactive/interactive-mode.js (before patching)
if (text === "/model" || text.startsWith("/model ")) {
    ...
    await this.handleModelCommand(searchTerm);
    return;
}
```

This check runs in the `onSubmit` handler, **before** the `input` event fires:

| Attempt | Mechanism | Result |
|---------|-----------|--------|
| `pi.registerCommand("model", ...)` | Extension command with same name | ❌ Built-in check runs first; warning: *"conflicts with built-in interactive command"* |
| `pi.on("input", ...)` intercepting `/model` | Intercept raw input via event | ❌ The `input` event fires **after** the built-in check — it never sees `/model` |
| **Patch the dist file** | Comment out the built-in `/model` handler | ✅ `/model` falls through to `session.prompt()` → `input` event → our extension |

---

## How It Works

Both entry points call the same `showSelector()` function which:

- Lists all models via `ctx.modelRegistry.getAll()`
- Sorts globally by input cost (cheapest first, unknown-cost models at the bottom)
- Computes max model ID width for column alignment
- Uses `getSupportedThinkingLevels()` from `@earendil-works/pi-ai` for thinking level info
- Displays a `SelectList` with substring-match filter (type to narrow down)
- On selection, calls `pi.setModel(model)`

### Patch management

**Apply** (after every `pi update` or `npm update -g`):

```bash
./patches/enhanced-model-selector/apply.sh
```

The script auto-detects the pi package root (works with nvm, fnm, global npm), skips if already patched, and uses `patch -p1` to apply [`../../patches/enhanced-model-selector/interactive-mode.patch`](../../patches/enhanced-model-selector/interactive-mode.patch).

**Revert**:

```bash
./patches/enhanced-model-selector/revert.sh
```

Both the `.patch` file and the scripts are **git-tracked** in this repo.

---

## Dependencies

- `@earendil-works/pi-ai` — `getSupportedThinkingLevels`, model types
- `@earendil-works/pi-coding-agent` — `DynamicBorder`, extension types
- `@earendil-works/pi-tui` — `Container`, `Key`, `SelectItem`, `SelectList`, `Text`

---

## Caveats

- **Reapply after updates**: the patch must be reapplied after every `pi update` or `npm update -g @earendil-works/pi-coding-agent`. If `/model` stops showing the enhanced selector, re-run `apply.sh`.
- **Fragile patch**: the patch targets a specific code pattern in `interactive-mode.js`. Future pi versions may change this code. If `apply.sh` fails with a hunk error, the `.patch` file needs updating to match the new dist source.
- **Shortcut conflict**: `Ctrl+L` is reserved by pi (clear screen / built-in model shortcut). The extension uses `Ctrl+Shift+L` instead. Check for conflicts with other extensions that may bind the same chord.
