# Harness Config

This file is the map to `~/.pi/agent/` — every customization made to your Pi harness and the workflows for making them. You loaded it because the user asked about modifying you or your own harness.

Every customization has its own topic folder under `docs/`, each with a `CONTEXT.md` that explains what was done and how it works. Use the Quick Navigation table below to find the right one, drop into its `CONTEXT.md`, and follow the instructions.

Pi documentation lives at: `$(npm root -g)/@earendil-works/pi-coding-agent/docs/`

## Symlink Structure

`~/.pi/agent/` is a directory of symlinks pointing into `~/Developper/Projects/dotpi/`.
Always write through `~/.pi/agent/`, never directly into `dotpi/`. Git commits and pushes go to the dotpi repo.

## Folder Structure

```
~/.pi/agent/
├── AGENTS.md               ← loaded at startup
├── CONTEXT.md              ← You are here (topic router)
├── auth.json               ← Provider credentials (gitignored)
├── auth.json.template      ← Template for auth.json (committed)
├── settings.json           ← Global settings
├── trust.json              ← Trust settings
├── bin/                    ← fd, rg (Rust binaries for find/grep)
├── specs/                  ← Design specs for future extensions
├── extensions/             ← Auto-discovered extensions
│   ├── command-validator.ts
│   ├── commit-validator.ts
│   ├── enhanced-model-selector.ts
│   ├── extended-global-context.ts
│   ├── git-commits-push-enforcer.ts
│   ├── path-guard.ts
│   ├── post-write-linter.ts
│   ├── read-deduplicator.ts
│   ├── secret-scanner.ts
│   ├── read-deduplicator-internals/
│   └── __tests__/          ← tests (bun test __tests__/)
├── sessions/               ← Pi's session history
├── docs/                   ← All harness documentation
│   ├── CONTEXT.md          ← Index of all modifications
│   ├── command-validator.md                      ← Bash security rules
│   ├── commit-validator.md                       ← How commits are validated
│   ├── creating-extensions.md                    ← Conventions for new extensions
│   ├── enhanced-model-selector.md                ← How model picker has been extended with costs
│   ├── extended-global-context.md                ← How global context has been extended
│   ├── git-commits-push-enforcer.md              ← How to commit & push
│   ├── git-commits-push-skill-retry-overhaul.md  ← Unified retry on all catches
│   ├── managing-api-keys-in-pi.md                ← How you manage API keys
│   ├── path-guard.md                             ← Blocks writes to dot* repos
│   ├── post-write-linter.md                      ← Runs Biome after every write/edit
│   ├── read-deduplicator.md                      ← avoids re-injecting already-read files + blocked-reads log
│   └── zero-timeout-filter.md                    ← Strips external timeout from git-commits-push skill
├── patches/                ← Pi dist patches
│   └── enhanced-model-selector/
│       ├── interactive-mode.patch
│       ├── apply.sh
│       └── revert.sh
└── tsconfig.json           ← TypeScript config for VSCode
```

## Quick Navigation

| Want to...                                  | Go here                                                                                  |
|---------------------------------------------|------------------------------------------------------------------------------------------|
| Understand Pi's auth bridge                 | `docs/managing-api-keys-in-pi.md` (How you manage API keys)                              |
| Understand the enhanced model selector      | `docs/enhanced-model-selector.md` (How model picker has been extended with costs)        |
| Understand the commit validation extensions | `docs/commit-validator.md` (How commits are validated)                                   |
| Understand the git push enforcer            | `docs/git-commits-push-enforcer.md` (How to commit & push)                               |
| Understand the command validator            | `docs/command-validator.md` (Bash security rules)                                        |
| Understand the path guard                   | `docs/path-guard.md` (blocks writes to dot* repos)                                       |
| Understand the read deduplicator            | `docs/read-deduplicator.md` (avoids re-injecting already-read files + blocked-reads log) |
| Understand the global context extension     | `docs/extended-global-context.md` (How global context has been extended)                 |
| Understand the post-write linter            | `docs/post-write-linter.md` (Runs Biome after every write/edit)                          |
| Run extension tests                         | `extensions/__tests__/` (`bun test`)                                                     |
| Reapply patches after pi update             | `patches/enhanced-model-selector/apply.sh`                                               |
| Conventions for new extensions              | `docs/creating-extensions.md` (Conventions for new extensions)                           |
| See all harness modifications               | `docs/CONTEXT.md`                                                                        |

## Transversal Skills

| Want to...                                          | Use this skill                    |
|-----------------------------------------------------|-----------------------------------|
| Safely create symlinks for dot-folders              | `/create-symlink-for-dot-folders` |
| Enforce conventional commits and push               | `/git-commits-push`               |
| Create or update a new skill                        | `/skill-creator`                  |


| Understand the retry mechanism in git-commits-push | `docs/git-commits-push-skill-retry-overhaul.md` (Unified retry on all catches) |

| Understand the zero-timeout filter | `docs/zero-timeout-filter.md` (Strips external timeout from git-commits-push skill) |
