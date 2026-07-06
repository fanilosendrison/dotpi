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

### 4. Git Commits Push Enforcer
- **Date** : 2026-06-28
- **Doc** : [`git-commits-push-enforcer.md`](git-commits-push-enforcer.md)

### 5. Command Validator
- **Date** : 2026-06-28
- **Doc** : [`command-validator.md`](command-validator.md)

### 6. Path Guard
- **Date** : 2026-06-28
- **Doc** : [`path-guard.md`](path-guard.md)

### 7. Read Deduplicator
- **Date** : 2026-06-29
- **Doc** : [`read-deduplicator.md`](read-deduplicator.md)

### 8. Post-Write Linter
- **Date** : 2026-07-01
- **Doc** : [`post-write-linter.md`](post-write-linter.md)

### 9. Git Commits Push Skill — Retry Overhaul
- **Date** : 2026-07-04
- **Doc** : [`git-commits-push-skill-retry-overhaul.md`](git-commits-push-skill-retry-overhaul.md)

### 10. Zero-Timeout Filter
- **Date** : 2026-07-05
- **Doc** : [`zero-timeout-filter.md`](zero-timeout-filter.md)

### 11. Secret Scanner
- **Date** : 2026-07-05
- **Doc** : [`secret-scanner.md`](secret-scanner.md)
