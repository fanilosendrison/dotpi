# Post-Write Linter

## Where / What

An extension that runs Biome (`check --write`) on every file written or edited
by Pi, and converts the tool result into an error when diagnostics remain after
auto-fixing. The agent sees the exact Biome output in the same turn as the edit
and must fix it before moving on.

| What | Where |
|------|-------|
| Extension entry point | `~/.pi/agent/extensions/post-write-linter.ts` |
| Shared linter core | `~/.agents/agent-enforcers/post-write-linter/src/core/linter.ts` |
| Shared patch-files extractor | `~/.agents/agent-enforcers/post-write-linter/src/core/patch-files.ts` |
| Biome runner | `bun x @biomejs/biome check --write` |


---

## How It Works

### Hook

Listens to `tool_result` and filters on `toolName === "write" || toolName === "edit"`.
Reads the target path through this fallback chain (tools use different parameter names):

```ts
const filePath = event.input?.file_path
  || event.input?.path
  || event.input?.TargetFile;
if (!filePath || typeof filePath !== "string") return;
```

If no string path is present, the hook is a no-op.

### Linter core (`checkFile`)

Lives in the shared core (reusable by other agent harnesses). Behavior:

1. Returns `{success: true}` immediately if the file does not exist or its extension is not `.ts/.tsx/.js/.jsx/.json`
2. Otherwise runs `bun x @biomejs/biome check --write "<file>"` via `execSync`
3. Catches non-zero exits and returns `{success: false, output: stdout || stderr || message}`
4. **`--write` is applied**, so Biome auto-fixes what it can — only unfixable diagnostics surface

Runner detection uses `process.argv[0]` to spot `bun`; falls back to `~/.bun/bin/bun` otherwise.

### Result handling

| Linter outcome | Extension returns |
|----------------|-------------------|
| `success: true` (no errors or no-op) | Nothing — Pi accepts the result |
| `success: false, output` | `isError: true` with `Biome linter errors in <path>:\n\n<output>` — agent must fix |
| Exception thrown inside `checkFile` | `isError: true` with `Internal Linter Error: ... <message>` — surfaces to the agent |

The Biome output is included verbatim so the agent can read the exact diagnostics without re-running the linter.

### Limits

| Limit | Impact |
|-------|--------|
| Biome is auto-fixing (`--write`) | Files written by Pi end up already linted — the agent only sees what Biome couldn't fix |
| Only `.ts/.tsx/.js/.jsx/.json` | No-op on Markdown, YAML, scripts without an extension, etc. |
| No batching | Each `write`/`edit` is linted separately — N edits = N Biome runs |
| Symlink resolution | None — the file path is passed straight to Biome |


---

## Relevant Files

| File | Purpose | Versioned |
|------|---------|-----------|
| `dotpi/extensions/post-write-linter.ts` | Pi extension — hooks `tool_result`, delegates to shared core | ✅ committed |
| `dotagents/agent-enforcers/post-write-linter/src/core/linter.ts` | Shared linter — `checkFile()` runs Biome | ✅ committed |
| `dotagents/agent-enforcers/post-write-linter/src/core/patch-files.ts` | Helper — extracts touched files from `apply_patch` blocks (currently unused by Pi extension; available for `bash`-side interception) | ✅ committed |
| `dotagents/agent-enforcers/post-write-linter/src/core/patch-files.test.ts` | Unit tests for the patch-files extractor | ✅ committed |
| `dotagents/agent-enforcers/post-write-linter/src/bin/post-tool-use.ts` | CLI bin for hook harnesses that don't import as a module | ✅ committed |
| `dotagents/agent-enforcers/post-write-linter/src/bin/post-tool-use.test.ts` | Tests for the CLI bin | ✅ committed |


---

## Background

The agent was writing TypeScript without consistent formatting and Biome config
enforcement. There was no mechanical feedback loop: lint errors would only surface
on the next read or the next provider request — wasting turns and context.

The `post-write-linter` extension closes that loop by intercepting every
`write`/`edit` tool result and running Biome (`check --write`) before Pi accepts
the result. Biome auto-fixes what it can, and surfaces only the diagnostics that
need human attention. The agent gets immediate feedback in the same turn as the
edit, can read the exact error message, and fix it before moving on.

The shared core lives in `dotagents/agent-enforcers/post-write-linter/` so other
agent harnesses (Claude Code, Codex) can reuse the same linting logic without
duplication.
