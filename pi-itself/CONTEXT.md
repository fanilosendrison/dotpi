# Pi Itself — Harness Modification Docs

This folder documents all modifications made to pi itself. Executable patches and
scripts live in `../patches/`.

When the user asks to modify pi (the harness, the agent), look here first to understand what's already been done, then document any new changes.

## How to Add a New Modification

1. Create a folder with a descriptive name: `pi-itself/<topic>/`
2. Add a `CONTEXT.md` inside explaining: what was changed, why, how it works, relevant files
3. Add an entry below with date and link
4. Update `../AGENTS.md` with a row in the Quick Navigation table

## Existing Modifications

### 1. Enhanced Model Selector
- **Date** : 2026-06-27
- **Doc** : [`enhanced-model-selector/CONTEXT.md`](enhanced-model-selector/CONTEXT.md)

### 2. Auth via Doppler (`!command`)
- **Date** : 2026-06-27
- **Doc** : [`managing-api-keys/CONTEXT.md`](managing-api-keys/CONTEXT.md)

### 3. Extended Global Context
- **Date** : 2026-06-28
- **Doc** : [`extended-global-context/CONTEXT.md`](extended-global-context/CONTEXT.md)

### 4. Commit Validation Extensions
- **Date** : 2026-06-28
- **Doc** : [`commit-validation/CONTEXT.md`](commit-validation/CONTEXT.md)

### 5. Git Commits Push Enforcer
- **Date** : 2026-06-28
- **Doc** : [`git-commits-push-enforcer/CONTEXT.md`](git-commits-push-enforcer/CONTEXT.md)

### 6. Command Validator
- **Date** : 2026-06-28
- **Doc** : [`command-validator/CONTEXT.md`](command-validator/CONTEXT.md)
