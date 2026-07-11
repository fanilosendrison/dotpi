# /cwd Interactive Directory Browser

## Goal

Transform `/cwd` from a bash-like `flag + path` command into an **interactive keyboard-driven directory browser** that opens via overlay when `/cwd` is typed without arguments. The existing `flag + path` syntax remains fully supported for fast/scripted use.

### User experience

1. User types `/cwd` (no args) → an overlay opens showing the current directory's subdirectories
2. User navigates with ↑↓/Enter/Backspace (see keyboard table below)
3. User presses Enter on **"📂 Use this directory"** → a second overlay shows split type options
4. User picks split type with Enter → a new WezTerm pane opens at the chosen directory

---

## Where to find Pi TUI docs

The Pi harness ships built-in TUI documentation. Read it first:

```
$(npm root -g)/@earendil-works/pi-coding-agent/docs/tui.md
```

Key sections:

| Topic | Section in tui.md |
|-------|-------------------|
| Component interface (`render`, `handleInput`, `invalidate`) | "Component Interface" |
| Overlays (`ctx.ui.custom` with `{ overlay: true }`) | "Overlays" |
| Keyboard input (`matchesKey`, `Key.*`) | "Keyboard Input" |
| Caching renders for performance | "Performance" |
| Theme colors (`theme.fg(...)`, `theme.bg(...)`) | "Theming" |
| SelectList built-in component | "Pattern 1: Selection Dialog (SelectList)" |
| Pattern with DynamicBorder framing | "Pattern 1" |
| `truncateToWidth` for line truncation | "Line Width" |

Reference examples (resolve against `$(npm root -g)/@earendil-works/pi-coding-agent/examples/extensions/`):

- `preset.ts` — SelectList overlay with DynamicBorder (closest pattern to what we need)
- `tools.ts` — SelectList + SettingsList overlays

---

## Files to modify

| File | What changes |
|------|-------------|
| `~/.pi/agent/extensions/cwd.ts` | Add `DirectoryBrowser` component, `SplitTypePicker`, `interactiveCwd()` function, wire into `handleCwdCommand` |
| `~/.pi/agent/extensions/__tests__/cwd.test.ts` | Add tests for the new interactive path and the DirectoryBrowser logic |
| `~/.pi/agent/docs/cwd-wezterm-split.md` | Update docs to document the interactive mode |

---

## Implementation plan

### Step 1 — `DirectoryBrowser` component (new, in `cwd.ts`)

A custom TUI component that lives in `cwd.ts` (private to the extension, not exported from `@earendil-works/pi-tui`).

**State it holds:**

```typescript
class DirectoryBrowser {
  private currentPath: string;      // absolute path currently displayed
  private entries: Dirent[];        // subdirectories of currentPath (sorted)
  private selectedIndex: number;    // currently highlighted entry
  private cachedWidth?: number;
  private cachedLines?: string[];

  // Callbacks (set by caller before rendering)
  public onSelect?: (path: string) => void;   // user confirmed a directory
  public onCancel?: () => void;               // user pressed Escape
}
```

**Constructor:**

```typescript
constructor(startPath: string, theme: Theme)
```

- Resolves `startPath` to an absolute path via `path.resolve()`
- Calls a private `refreshEntries()` that uses `fs.readdirSync(path, { withFileTypes: true })`, filters to directories only, filters out dotfiles (entries starting with `.`), and sorts alphabetically

**Rendering (`render(width: number): string[]`):**

Produces lines in this order:

```
─────────────────────────────────   ← DynamicBorder (top)
  Navigate to directory              ← bold title, fg("accent")
                                     ← Spacer(1)
  📁 /Users/famillesendrison/Devel   ← breadcrumb (fg("muted"), truncated)
─────────────────────────────────   ← DynamicBorder (separator)
  📂 Use this directory              ← item 0 (always first, fg("success") when selected, fg("dim") otherwise)
  ..                                ← item 1 (if not at root `/`) (fg("muted"))
  📁 Projects/                      ← entries[0] (selected indicator + icon)
  📁 Documents/                     ← entries[1]
  ...                               ← entries[2..]
─────────────────────────────────   ← DynamicBorder (bottom)
  ↑↓ navigate · ↵ enter · ⌫ back · esc cancel   ← help line (fg("dim"))
```

**Selection logic:**

- Index 0 = "📂 Use this directory" (confirm current path)
- Index 1 = ".." (only present if not at `/`)
- Index 2+ = subdirectory entries (offset by `(hasParent ? 1 : 0) + 1`)

**Keyboard handling (`handleInput(data: string): void`):**

| Key | Action |
|-----|--------|
| `Key.up` | `selectedIndex--` (clamped to 0) |
| `Key.down` | `selectedIndex++` (clamped to entries.length + fixed items - 1) |
| `Key.enter` | If index 0: call `onSelect(currentPath)`. If index 1 (..): `currentPath = dirname(currentPath)`, refresh entries, reset index. If index ≥ 2: `currentPath = join(currentPath, entry.name)`, refresh entries, reset index to 0. |
| `Key.backspace` | Same as selecting ".." (go to parent) |
| `Key.left` | Same as backspace (go to parent) |
| `Key.escape` | Call `onCancel()` |
| `Key.home` | Jump to index 0 |
| `Key.end` | Jump to last entry |

**Performance:**

- Cache `render()` output with `cachedWidth` / `cachedLines`. Invalidate on any state change.
- `refreshEntries()` must be called on every directory change. Use `readdirSync` — it's fast for local directories and we're only listing directories, not full trees.

**Styling:**

- Use `theme` passed to constructor.
- Selected item: `theme.fg("accent", ...)` with a `> ` prefix.
- Non-selected: plain text, `theme.fg("dim", ...)` for help/breadcrumb.

### Step 2 — `SplitTypePicker` (new, in `cwd.ts`)

A thin wrapper over Pi's built-in `SelectList`. This is NOT a separate Component class — it's a function that opens a SelectList overlay.

```typescript
async function pickSplitType(
  ctx: ExtensionContext,
  ui: { custom: ... }
): Promise<SplitType | null>
```

Uses `ctx.ui.custom<string | null>(...)` with `SelectList` items:

```
Bottom         (value: "--bottom")
Top            (value: "--top")
Right          (value: "--right")
Left           (value: "--left")
Horizontal     (value: "--horizontal")
Vertical       (value: "--vertical")
New Tab        (value: "--tab")
```

Returns the selected `SplitType` or `null` if cancelled.

Follows the **exact same pattern** as `preset.ts` → `showPresetSelector()`:
- `DynamicBorder` top/bottom
- Bold title "Choose split type"
- `SelectList` with themed callbacks
- Help line "↑↓ navigate · enter select · esc cancel"

### Step 3 — `interactiveCwd()` function (new, in `cwd.ts`)

This is the main orchestrator. It:

1. Opens a `DirectoryBrowser` overlay at `ctx.cwd`:

```typescript
async function interactiveCwd(
  ctx: CwdCommandContext,
  deps: CwdCommandDependencies
): Promise<void> {
  const selectedDir = await new Promise<string | null>((resolve) => {
    ctx.ui.custom((tui, theme, _kb, done) => {
      const browser = new DirectoryBrowser(ctx.cwd, theme);
      browser.onSelect = (path) => done(path);
      browser.onCancel = () => done(null);

      return {
        render: (w) => browser.render(w),
        invalidate: () => browser.invalidate(),
        handleInput: (data) => {
          browser.handleInput(data);
          tui.requestRender();
        },
      };
    });
  });

  if (selectedDir === null) return;

  const splitType = await pickSplitType(ctx);
  if (splitType === null) return;

  if (!deps.directoryExists(selectedDir)) {
    ctx.ui.notify(`Directory not found: ${selectedDir}`, "error");
    return;
  }

  try {
    deps.runWezTerm(buildWezTermArgs(splitType, selectedDir));
    ctx.ui.notify(`Pi opened in split pane: ${selectedDir}`, "info");
  } catch {
    ctx.ui.notify("wezterm CLI not available. Are you inside WezTerm?", "error");
  }
}
```

### Step 4 — Wire into `handleCwdCommand`

In `handleCwdCommand`, add a branch at the **very beginning**:

```typescript
// No args → interactive mode
if (args.trim() === "") {
  await interactiveCwd(ctx, dependencies);
  return;
}
```

The rest of the function (existing logic) stays untouched — `parseCwdArgs` → directory check → `buildWezTermArgs` → `runWezTerm`.

### Step 5 — Tests (in `cwd.test.ts`)

Add a new `describe("interactiveCwd", ...)` block. Because the interactive flow uses `ctx.ui.custom()` (Pi TUI overlays), testing the full flow requires mocking `ctx.ui.custom`.

Test cases:

1. **`DirectoryBrowser` unit tests** (pure logic, no DOM/TUI):
   - Constructor initializes with correct `currentPath`
   - `refreshEntries` lists only directories, sorted, no dotfiles
   - `handleInput` with `Key.up` / `Key.down` changes `selectedIndex`
   - `handleInput` with `Key.enter` on index 0 calls `onSelect` with current path
   - `handleInput` with `Key.enter` on a subdirectory updates `currentPath`
   - `handleInput` with `Key.backspace` or `Key.left` goes to parent
   - `handleInput` with `Key.escape` calls `onCancel`
   - At `/` root, no ".." entry is shown (verify via render output)
   - Render output is cached and invalidated correctly

2. **`interactiveCwd` integration test** (mock `ctx.ui.custom`):
   - Mock returns a directory → verifies `runWezTerm` is called with correct args
   - Mock returns null → verifies `runWezTerm` is NOT called
   - SplitTypePicker cancelled → verifies `runWezTerm` is NOT called

3. **Backward compatibility** — existing tests must pass unchanged.

### Step 6 — Update documentation

In `~/.pi/agent/docs/cwd-wezterm-split.md`:

- Add a new section titled "Interactive Directory Browser" after the flag/path docs
- Document: "Type `/cwd` with no arguments to open an interactive directory browser"
- List keyboard shortcuts
- Keep all existing sections intact

In `~/.pi/agent/CONTEXT.md`:

- No change needed — the description already reads "Open Pi in another directory via a WezTerm pane or tab" which covers both modes.

---

## Architecture diagram

```
User types /cwd
       │
       ├── args present? ──→ parseCwdArgs() → buildWezTermArgs() → exec (existing path)
       │
       └── no args ──→ interactiveCwd()
                            │
                            ├── ctx.ui.custom(DirectoryBrowser) ── overlay 1
                            │       │
                            │       ├── user cancels → return
                            │       └── user selects dir → selectedDir
                            │
                            ├── pickSplitType() ── overlay 2 (SelectList)
                            │       │
                            │       ├── user cancels → return
                            │       └── user picks type → splitType
                            │
                            └── directoryExists() + buildWezTermArgs() + runWezTerm()
                                    │
                                    └── notify("Pi opened in split pane: <dir>")
```

---

## Design decisions

| Decision | Rationale |
|----------|-----------|
| List only directories (no files) | The goal is to pick a working directory for a new Pi instance. Files are irrelevant noise. |
| Hide dotfiles/dotdirs | `.git`, `.DS_Store`, `node_modules` clutter the view. The user navigates project directories, not internals. |
| "📂 Use this directory" as first entry | Without it, the user must navigate to a parent and then into the target — unintuitive. This lets them confirm any displayed directory instantly. |
| `Key.backspace` and `Key.left` both go up | Intuitive for users: backspace = "go back", left = "go up the tree". |
| Separate overlay for split type | Keeps each overlay focused on one decision. SelectList handles this perfectly. |
| Keep `parseCwdArgs` / `buildWezTermArgs` untouched | They're well-tested and serve the fast path. No reason to touch them. |
| No mouse support | Pi TUI does not expose mouse events in the component API. All interaction is keyboard-driven. |

---

## Import checklist

New imports needed in `cwd.ts`:

```typescript
import { readdirSync } from "node:fs";              // directory listing
import { dirname } from "node:path";                 // parent directory
import { DynamicBorder } from "@earendil-works/pi-coding-agent";
import {
  Container,
  Key,
  matchesKey,
  type SelectItem,
  SelectList,
  Text,
  truncateToWidth,
} from "@earendil-works/pi-tui";
import type { Theme } from "@earendil-works/pi-tui"; // for DirectoryBrowser constructor
```

Note: `resolve` is already imported as `import { resolve } from "node:path"`. Add `dirname` and `join` (already available via `resolve`) to that same line. `readdirSync` is separate from `existsSync`/`statSync` already imported.
