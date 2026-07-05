# Docs — Harness Modification Docs

This folder documents all modifications made to pi itself. Executable patches and
scripts live in `../patches/`.

When the user asks to modify pi (the harness, the agent), look here first to understand what's already been done, then document any new changes.

## How to Add a New Modification

1. Create a markdown file with a descriptive name: `docs/<topic>.md`
2. Write inside explaining: what was changed, why, how it works, relevant files
3. Add an entry below with date and link
4. Update the `CONTEXT.md` Quick Navigation table

## Existing Modifications

### 1. Enhanced Model Selector
- **Date** : 2026-06-27
- **Doc** : [`enhanced-model-selector.md`](enhanced-model-selector.md)

### 2. Auth via Doppler (`!command`)
- **Date** : 2026-07-02
- **Doc** : [`managing-api-keys-in-pi.md`](managing-api-keys-in-pi.md)

### 3. Extended Global Context
- **Date** : 2026-06-28
- **Doc** : [`extended-global-context.md`](extended-global-context.md)

### 4. Commit Validation Extensions
- **Date** : 2026-06-28
- **Doc** : [`commit-validator.md`](commit-validator.md)

### 5. Git Commits Push Enforcer
- **Date** : 2026-06-28
- **Doc** : [`git-commits-push-enforcer.md`](git-commits-push-enforcer.md)

### 6. Command Validator
- **Date** : 2026-06-28
- **Doc** : [`command-validator.md`](command-validator.md)

### 7. Path Guard
- **Date** : 2026-06-28
- **Doc** : [`path-guard.md`](path-guard.md)

### 8. Read Deduplicator
- **Date** : 2026-06-29
- **Doc** : [`read-deduplicator.md`](read-deduplicator.md)

### 9. Post-Write Linter
- **Date** : 2026-07-01
- **Doc** : [`post-write-linter.md`](post-write-linter.md)

### 10. Git Commits Push Skill — Retry Overhaul
- **Date** : 2026-07-04
- **Doc** : [`git-commits-push-skill-retry-overhaul.md`](git-commits-push-skill-retry-overhaul.md)

### 11. Zero-Timeout Filter
- **Date** : 2026-07-05
- **Doc** : [`zero-timeout-filter.md`](zero-timeout-filter.md)
