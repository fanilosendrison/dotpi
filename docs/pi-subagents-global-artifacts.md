---
okf_version: "1.0"
kind: "KnowledgeAsset"
asset_type: "documentation"
domain: "pi-harness"
severity: "guideline"
name: "Pi Subagents Global Artifacts"
---

# Pi Subagents Global Artifacts

## Where / What

Project-scoped `pi-subagents` artifacts are stored outside the working tree. The namespace is derived from the canonical Git worktree root, or from the canonical working directory when no Git repository contains it.

| Data | Location | Scope |
| ---- | -------- | ----- |
| Child artifacts | `~/.pi-subagents/projects/<safe-root-name>--<sha256>/artifacts/` | One project namespace |
| Foreground chain state | `~/.pi-subagents/projects/<safe-root-name>--<sha256>/chain-runs/` | One project namespace |
| Session fallback artifacts | Adjacent to the session file | Runs without a project CWD |

The namespace root and its managed directories are created with owner-only permissions. A project working tree must not contain `.pi-subagents/`.

## How It Works

The artifact resolver walks upward from the effective CWD to find a Git marker. It hashes the canonical scope path and combines that hash with a filesystem-safe basename. This keeps separate worktrees isolated while keeping nested CWDs in the same worktree together.

```text
~/.pi-subagents/projects/<safe-root-name>--<sha256>/
├── artifacts/
└── chain-runs/
```

Use the doctor action to inspect the effective paths for a running project:

```text
subagent({ action: "doctor" })
```

| Placeholder | Meaning |
| ----------- | ------- |
| `<safe-root-name>` | Sanitized basename of the resolved project scope |
| `<sha256>` | SHA-256 digest of the canonical project scope path |

Retention cleanup removes only old, completed artifact groups identified by their metadata file. It preserves incomplete groups, unknown files, and symbolic links. Legacy recovery descriptors are rerouted to the current global namespace when resumed.

Default project chain directories are persistent and are not removed by the artifact retention cleanup.

## Related Turnlock State

Turnlock runtime state is routed independently through the shell environment:

```bash
export TURNLOCK_RUN_DIR_ROOT="$HOME/.turnlock/runs"
```

Turnlock resolves the environment variable before `OrchestratorConfig.runDirRoot` and its portable `.turnlock/runs` default. The user-level override keeps runtime state outside project working trees without changing Turnlock's repository-independent default.

## Relevant Files

| File | Purpose | Versioned |
| ---- | ------- | --------- |
| `extensions/pi-subagents-4-turnlock/src/shared/artifacts.ts` | Resolves paths, creates private directories, and cleans artifact groups | ✅ |
| `extensions/pi-subagents-4-turnlock/src/runs/foreground/subagent-executor.ts` | Routes foreground, chain, and resumed runs into the project namespace | ✅ |
| `extensions/pi-subagents-4-turnlock/src/extension/doctor.ts` | Reports global artifact and chain-run locations | ✅ |
| `extensions/pi-subagents-4-turnlock/README.md` | Documents user-visible artifact storage behavior | ✅ |
| `~/.pi-subagents/` | User-local artifact storage | ❌ |
| `~/.zshenv` | User-local Turnlock run-root override | ❌ |

## Background

The storage layout was migrated to keep tool state out of source repositories while retaining session observability. Existing project-local artifacts can be copied to the matching global namespace before their local copies are removed.