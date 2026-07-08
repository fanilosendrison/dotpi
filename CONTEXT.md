# Harness Config

This file is the map to `~/.pi/agent/` — every customization made to your Pi harness and the workflows for making them. You loaded it because the user asked about modifying you or your own harness.

Every customization has its own topic folder under `docs/` that explains what was done and how it works. Use the Quick Navigation table below to find the right one and follow the instructions.

Pi documentation lives at: `$(npm root -g)/@earendil-works/pi-coding-agent/docs/`

## Gateway Folder — CRITICAL

`~/.pi/agent/` acts as a symlink gateway to its git repo. It is a physical folder that *contains* symlinks to the repo.

> ⚠️ **PATH-GUARD WARNING**: You must **NEVER** write directly to the physical git repo (`~/Developper/Projects/dotpi`). If you attempt to write there, the `path-guard` enforcer will intentionally intercept your action. Your command will be either **strictly blocked** or **silently redirected** to the `~/.pi/agent/` gateway. **This is normal and expected behavior.** Do not try to bypass or hack around this restriction; simply follow the rules and use the `~/.pi/agent/` gateway.

**You must edit directly** through the `~/.pi/agent/` paths. 
**Before you commit**, you must resolve a symlink to reach the physical git repo:

```bash
cd $(dirname "$(readlink ~/.pi/agent/AGENTS.md)") && /git-commits-push
```

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
│   ├── enhanced-model-selector.ts
│   ├── extended-global-context.ts
│   ├── git-commits-push-enforcer.ts
│   ├── path-guard.ts
│   ├── post-write-linter.ts
│   ├── read-deduplicator.ts
│   ├── read-deduplicator-internals/
│   │   ├── read-tracker.ts
│   │   └── read-tracker.test.ts
│   ├── zero-timeout-filter.ts
│   └── __tests__/          ← tests d'intégration (bun test extensions/__tests__/)
├── sessions/               ← Pi's session history
├── docs/                   ← All harness documentation
│   ├── CONTEXT.md          ← Index of all modifications
│   ├── command-validator.md                      ← Bash security rules
│   ├── context-section-color.md                  ← Rose Pine yellow [Context] header
│   ├── creating-extensions.md                    ← Conventions for new extensions
│   ├── enhanced-model-selector.md                ← How model picker has been extended with costs
│   ├── extended-global-context.md                ← How global context has been extended
│   ├── git-commits-push-enforcer.md              ← How to commit & push
│   ├── git-commits-push-skill-retry-overhaul.md  ← Unified retry on all catches
│   ├── managing-api-keys-in-pi.md                ← How you manage API keys
│   ├── path-guard.md                             ← Blocks writes to dot* repos
│   ├── post-write-linter.md                      ← Runs Biome after every write/edit
│   │   ├── read-deduplicator.md                      ← avoids re-injecting already-read files + blocked-reads log
│   └── zero-timeout-filter.md                    ← Strips external timeout from git-commits-push skill
├── patches/                ← Pi dist patches
│   └── enhanced-model-selector/
│       ├── interactive-mode.patch
│       ├── apply.sh
│       └── revert.sh
└── tsconfig.json           ← TypeScript config for VSCode
```

## Quick Navigation

| Want to...                                       | Go here                                                                                  |
|--------------------------------------------------|------------------------------------------------------------------------------------------|
| Understand Pi's auth bridge                      | `docs/managing-api-keys-in-pi.md` (How you manage API keys)                              |
| Understand the enhanced model selector           | `docs/enhanced-model-selector.md` (How model picker has been extended with costs)        |
| Understand the git push enforcer                 | `docs/git-commits-push-enforcer.md` (How to commit & push)                               |
| Understand the retry mechanism                   | `docs/git-commits-push-skill-retry-overhaul.md` (Unified retry on all catches)           |
| Understand the command validator                 | `docs/command-validator.md` (Bash security rules)                                        |
| Understand the path guard                        | `docs/path-guard.md` (blocks writes to dot* repos)                                       |
| Understand the read deduplicator                 | `docs/read-deduplicator.md` (avoids re-injecting already-read files + blocked-reads log) |
| Understand the global context extension          | `docs/extended-global-context.md` (How global context has been extended)                 |
| Understand the post-write linter                 | `docs/post-write-linter.md` (Runs Biome after every write/edit)                          |
| Understand the zero-timeout filter               | `docs/zero-timeout-filter.md` (Strips external timeout from git-commits-push skill)      |
| Run extension integration tests                  | `extensions/__tests__/` (`bun test extensions/__tests__/`)                               |
| Run internals unit tests                         | `extensions/*-internals/__tests__/` (`bun test extensions/*-internals/__tests__/`)       |
| Reapply patches after pi update                  | `patches/enhanced-model-selector/apply.sh`                                               |
| Conventions for new extensions                   | `docs/creating-extensions.md` (Conventions for new extensions)                           |
| See all harness modifications                    | `docs/CONTEXT.md`                                                                        |

## Transversal Skills

| Want to...                                          | Use this skill                    |
|-----------------------------------------------------|-----------------------------------|
| Safely create symlinks for dot-folders              | `/create-symlink-for-dot-folders` |
| Make a commit                                       | `/git-commits-push`               |
| Create or update a new skill                        | `/skill-creator`                  |

| Understand the [Context] header color change | `docs/context-section-color.md` (Rose Pine yellow [Context] header) |
