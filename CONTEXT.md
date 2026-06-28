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
│   ├── command-validator.ts
│   ├── commit-validator.ts
│   ├── enhanced-model-selector.ts
│   ├── extended-global-context.ts
│   ├── git-commits-push-enforcer.ts
│   ├── secret-scanner.ts
│   └── __tests__/          ← unit tests (bun test __tests__/)
├── sessions/               ← Pi's session history
├── creating-extensions/
│   └── CONTEXT.md          ← Things to know when creating new extensions
├── documenting-self-modifications/
│   └── CONTEXT.md          ← How to document a harness modification
├── docs/                   ← Harness modification docs
│   ├── CONTEXT.md          ← Index of all modifications
│   ├── command-validator/
│   ├── commit-validation/
│   ├── enhanced-model-selector/
│   ├── extended-global-context/
│   ├── git-commits-push-enforcer/
│   └── managing-api-keys/
├── patches/                ← Pi dist patches
│   └── enhanced-model-selector/
│       ├── interactive-mode.patch
│       ├── apply.sh
│       └── revert.sh
└── tsconfig.json           ← TypeScript config for VSCode
```

## Quick Navigation

| Want to... | Go here |
|----------------------------------------------------------|-------------------------------------------------|
| Add / modify an API key | `docs/managing-api-keys/CONTEXT.md` |
| Understand the enhanced model selector | `docs/enhanced-model-selector/CONTEXT.md` |
| Understand the commit validation extensions | `docs/commit-validation/CONTEXT.md` |
| Understand the git push enforcer | `docs/git-commits-push-enforcer/CONTEXT.md` |
| Understand the command validator | `docs/command-validator/CONTEXT.md` |
| Understand the global context extension | `docs/extended-global-context/CONTEXT.md` |
| Run extension unit tests | `extensions/__tests__/` (`bun test`) |
| Document a new harness modification | `documenting-self-modifications/CONTEXT.md` |
| Things to know when creating new extensions | `creating-extensions/CONTEXT.md` |
| See all harness modifications | `docs/CONTEXT.md` |

## Writing Rules

- All English.
- Tables: separator dashes match header column widths exactly.
- No markdown lint violations.
- Use placeholders (`<project>`, `<config>`, `<agent_name>`) for real project/config
  names. Concrete values live in gitignored files only.
