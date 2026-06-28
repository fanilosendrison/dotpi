# Harness Config

This file is the map to `~/.pi/agent/` — every customization made to your Pi harness and the workflows for making them. You loaded it because the user asked about modifying you or your own harness.

Every customization has its own topic folder under `docs/`, each with a `CONTEXT.md`
that explains what was done and how it works. Use the Quick Navigation table below to
find the right one, drop into its `CONTEXT.md`, and follow the instructions.

Pi documentation lives at: `$(npm root -g)/@earendil-works/pi-coding-agent/docs/`

## Symlink Structure

`~/.pi/agent/` is a directory of symlinks pointing into `~/Developper/Projects/dotpi/`.
Always write through `~/.pi/agent/`, never directly into `dotpi/`. Git commits and pushes
go to the dotpi repo.

## Folder Structure

```
~/.pi/agent/
├── AGENTS.md               ← loaded at startup
├── CONTEXT.md              ← You are here (topic router)
├── auth.json               ← Provider credentials (gitignored)
├── auth.json.example       ← Template for auth.json (committed)
├── settings.json           ← Global settings
├── bin/                    ← fd, rg (Rust binaries for find/grep)
├── specs/                  ← Design specs for future extensions
├── extensions/             ← Auto-discovered extensions
│   ├── command-validator.ts
│   ├── commit-validator.ts
│   ├── enhanced-model-selector.ts
│   ├── extended-global-context.ts
│   ├── git-commits-push-enforcer.ts
│   ├── secret-scanner.ts
│   ├── path-guard.ts
│   └── __tests__/          ← unit tests (bun test __tests__/)
├── sessions/               ← Pi's session history
├── docs/                   ← All harness documentation
│   ├── CONTEXT.md          ← Index of all modifications
│   ├── command-validator/
│   │   └── CONTEXT.md         ← Bash security rules
│   ├── commit-validator/
│   │   └── CONTEXT.md         ← How commits are validated
│   ├── creating-extensions/
│   │   └── CONTEXT.md         ← Conventions for new extensions
│   ├── documenting-self-modifications/
│   │   └── CONTEXT.md         ← How to document harness changes
│   ├── enhanced-model-selector/
│   │   └── CONTEXT.md         ← How model picker has been extended with costs
│   ├── extended-global-context/
│   │   └── CONTEXT.md         ← How global context has been extended
│   ├── git-commits-push-enforcer/
│   │   └── CONTEXT.md         ← How to commit & push
│   ├── path-guard/
│   │   └── CONTEXT.md         ← Blocks writes to dot* repos
│   └── managing-api-keys/
│       └── CONTEXT.md         ← Doppler-based auth
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
| Add / modify an API key | `docs/managing-api-keys/CONTEXT.md` (Doppler-based auth) |
| Understand the enhanced model selector | `docs/enhanced-model-selector/CONTEXT.md` (How model picker has been extended with costs) |
| Understand the commit validation extensions | `docs/commit-validator/CONTEXT.md` (How commits are validated) |
| Understand the git push enforcer | `docs/git-commits-push-enforcer/CONTEXT.md` (How to commit & push) |
| Understand the command validator | `docs/command-validator/CONTEXT.md` (Bash security rules) |
| Understand the path guard | `docs/path-guard/CONTEXT.md` (blocks writes to dot* repos) |
| Understand the global context extension | `docs/extended-global-context/CONTEXT.md` (How global context has been extended) |
| Run extension unit tests | `extensions/__tests__/` (`bun test`) |
| Reapply patches after pi update | `patches/enhanced-model-selector/apply.sh` |
| Document a new harness modification | `docs/documenting-self-modifications/CONTEXT.md` (How to document harness changes) |
| Conventions for new extensions | `docs/creating-extensions/CONTEXT.md` (Conventions for new extensions) |
| See all harness modifications | `docs/CONTEXT.md` |

## Writing Rules

- All English.
- Tables: separator dashes match header column widths exactly.
- No markdown lint violations.
- Use placeholders (`<project>`, `<config>`, `<agent_name>`) for real project/config
  names. Concrete values live in gitignored files only.
