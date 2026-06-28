# Harness Config

This file is the map to `~/.pi/agent/` — every customization made to your Pi harness,
and the workflows for making them. You loaded it because the user asked about modifying
you or your own harness.

Pi documentation lives at: `$(npm root -g)/@earendil-works/pi-coding-agent/docs/`

## Symlink Structure

`~/.pi/agent/` is a directory with individual symlinks to `~/Developper/Projects/dotpi/`.
Write through `~/.pi/agent/`, never directly to `dotpi/`. Commits go to the dotpi repo.

## Folder Structure

```
~/.pi/agent/
├── AGENTS.md               ← loaded at startup
├── CONTEXT.md              ← You are here (topic router)
├── auth.json               ← Provider credentials (gitignored)
├── auth.json.example       ← Template for auth.json (committed)
├── settings.json           ← Global settings
├── bin/                    ← fd, rg (Rust binaries for find/grep)
├── extensions/             ← Auto-discovered extensions
│   ├── enhanced-model-selector.ts
│   └── extended-global-context.ts
├── sessions/               ← Pi's session history
├── documenting-self-modifications/
│   └── CONTEXT.md          ← How to document a harness modification
└── pi-itself/              ← Harness modifications
    ├── CONTEXT.md          ← Index of all modifications
    ├── enhanced-model-selector/
    ├── extended-global-context/
    └── managing-api-keys/
```

## Quick Navigation

| Want to... | Go here |
|------------|---------|
| Understand the symlink + commit workflow | `~/.agents/AGENTS.md` |
| Add / modify an API key | `pi-itself/managing-api-keys/CONTEXT.md` |
| Understand the enhanced model selector | `pi-itself/enhanced-model-selector/CONTEXT.md` |
| Understand the global context extension | `pi-itself/extended-global-context/CONTEXT.md` |
| Document a new harness modification | `documenting-self-modifications/CONTEXT.md` |
| See all harness modifications | `pi-itself/CONTEXT.md` |

## Writing Rules

- All English.
- Tables: separator dashes match header column widths exactly.
- No markdown lint violations.
- Use placeholders (`<project>`, `<config>`, `<agent_name>`) for real project/config
  names. Concrete values live in gitignored files only.
