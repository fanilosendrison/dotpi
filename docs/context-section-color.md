# Context Section Color

- **Date**: 2026-07-06
- **Type**: Pi dist patch (changes the `[Context]` startup header color)
- **Files**:
  - Git-tracked patch: [`interactive-mode.patch`](../patches/context-section-color/interactive-mode.patch)
  - Apply script: [`../../patches/context-section-color/apply.sh`](../../patches/context-section-color/apply.sh)
  - Revert script: [`../../patches/context-section-color/revert.sh`](../../patches/context-section-color/revert.sh)

## Quick Reference

- **Effect**: The `[Context]` section header shown at pi startup is now rendered in Rose Pine yellow (`gold` / `warning` color)
- **After `pi update`**: run `./patches/context-section-color/apply.sh`
- **Revert patch**: `./patches/context-section-color/revert.sh`

---

## What

When pi starts, it displays a loading summary listing the resources it found:

```
[Context]  AGENTS.md
[Skills]   git-commits-push, skill-creator, …
[Prompts]  …
[Extensions] …
[Themes]   rose-pine, …
```

Each section header is rendered as `[Name]` using a theme color. The default color for all sections is `mdHeading` (iris / purple in Rose Pine).

This patch makes **only** the `[Context]` header use the `warning` color, which maps to `gold` (`#f6c177`) — the Rose Pine yellow. Other section headers (`[Skills]`, `[Prompts]`, `[Extensions]`, `[Themes]`) remain in the default `mdHeading` color.

---

## Why

Visual distinction: the `[Context]` section is the most important startup listing (it shows which project instructions the agent will load). Using yellow makes it stand out at a glance.

---

## How It Works

The startup summary is rendered in `dist/modes/interactive/interactive-mode.js`. The `addLoadedSection()` helper renders each section:

```js
const addLoadedSection = (name, collapsedBody, expandedBody = collapsedBody, color = "mdHeading") => {
    const section = new ExpandableText(
        () => `${sectionHeader(name, color)}\n${collapsedBody}`,
        ...
    );
    ...
};

// Where sectionHeader renders the bracket-style label:
const sectionHeader = (name, color = "mdHeading") => theme.fg(color, `[${name}]`);
```

The `Context` section is called without a color argument, so it defaulted to `mdHeading`:

```js
addLoadedSection("Context", contextCompactList, contextList);
```

The patch adds `"warning"` as the explicit color:

```js
addLoadedSection("Context", contextCompactList, contextList, "warning"); // PATCHED by context-section-color
```

The `warning` color key is defined in Rose Pine themes as `"warning": "gold"`, which resolves to the Rose Pine yellow `#f6c177`.

### Patch management

**Apply** (after every `pi update` or `npm update -g`):

```bash
./patches/context-section-color/apply.sh
```

**Revert**:

```bash
./patches/context-section-color/revert.sh
```

---

## Relevant Files

| File | Purpose | Versioned |
|------|---------|-----------|
| `patches/context-section-color/interactive-mode.patch` | Git-tracked patch for `interactive-mode.js` | ✅ |
| `patches/context-section-color/apply.sh` | Apply script | ✅ |
| `patches/context-section-color/revert.sh` | Revert script | ✅ |
| `dist/modes/interactive/interactive-mode.js` | Pi dist file (patched in place) | ❌ (node_modules) |

---

## Caveats

- **Reapply after updates**: the patch must be reapplied after every `pi update` or `npm update -g @earendil-works/pi-coding-agent`.
- **Fragile patch**: targets a specific line in `interactive-mode.js`. Future pi versions may change this code. If `apply.sh` fails, the `.patch` file needs updating.
- **Theme-dependent**: the `warning` color resolves to `gold` in Rose Pine themes. Other themes may define `warning` differently — if you switch themes, the color may change.