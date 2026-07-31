---
okf_version: "1.0"
kind: "RuntimeArtifact"
format: "cubits-design-doc"
workspace: "go"
date: "2026-07-21"
step_id: 0
id: CDD-N-TURNLOCK-REGISTRY
version: "1.0.0"
scope: turnlock-runner-coordination
status: draft
consumers: [agent-generator]
superseded_by: []
---

# 📋 CDD-N-TURNLOCK-REGISTRY

## 1. Objectif & Position
Manages the `O_EXCL` coordination lock, atomic JSON I/O, and file format registry for Turnlock operations. This module encapsulates the locking mechanism entirely.

## 2. Goals & Non-Goals
**Goals:** Provide safe and atomic access to the Registry. Encapsulate the `O_EXCL` lock logic. Prevent TOCTOU vulnerabilities during I/O.
**Non-Goals:** It does not orchestrate subagents or manage their PGIDs directly.

## 3. Data Contracts
**Exposes:** `acquireLock()`, `releaseLock()`, `withLock(fn)`, `readCursor()`, `scanRetentionCandidates(cursor, limit)`, `writeCursorAndBatch(cursor, batch)` API.

```typescript
type DurableLaunchState = "spawn-intent" | "launcher-claimed" | "running" | "completed" | "failed" | "stopped";

interface RegistryFileV2 {
  readonly version: 2;
  readonly policyDigest: string;
  readonly collectorCursor?: string;
  readonly entries: Record<string, RegistryEntryV2>;
}

interface RegistryEntryV2 {
  readonly callerLaunchKey: string;
  readonly requestDigest: string;
  readonly groupSpecDigest: string;
  readonly dependencyExecutionId: string;
  readonly state: DurableLaunchState;
  readonly generation: number;
  readonly nonce: string;
  readonly relativeAsyncDir: string;
  readonly relativeResultNamespace: string;
  readonly processGroupId?: number;
  readonly launchPlan: ResolvedExecutionPlanV2;
  readonly jobs: Record<string, RegistryJobEntryV2>;
  readonly createdAtEpochMs: number;
  readonly updatedAtEpochMs: number;
  readonly terminalAtEpochMs?: number;
  readonly stopRequestedAtEpochMs?: number;
  readonly stopReason?: string;
  readonly fenceGeneration?: number;
  readonly claimDeadlineEpochMs?: number;
}

interface RegistryJobEntryV2 {
  readonly jobId: string;
  readonly state: "pending" | "running" | "success" | "failure" | "stopped";
  readonly targetRef: ArtifactTargetRefV1;
  readonly resultCommitment?: ArtifactCommitmentV2;
  readonly terminalAtEpochMs?: number;
  readonly retentionState?: "receipt" | "delete-intent" | "deleted" | "tombstone";
  readonly retentionReceipt?: RetentionReceiptV2;
  readonly deleteIntentAtEpochMs?: number;
  readonly deletedAtEpochMs?: number;
  readonly tombstoneExpiryAtEpochMs?: number;
}

interface RetentionReceiptV2 {
  readonly acknowledgedDigests: Record<string, string>;
  readonly receiptCommitment: ArtifactCommitmentV2;
  readonly earliestCleanupAtEpochMs: number;
}
```

## 4. Pipeline
1. `acquireLock()`: `O_EXCL` open lock file, write `ProcessInstanceIdentityV1`, fsync.
2. `withLock(fn)`: Calls acquire, runs `fn`, calls release.
3. `readCursor()`: Reads `RegistryFileV2.collectorCursor` under lock.
4. `scanRetentionCandidates(cursor, limit)`: Scans entries whose `retentionState` is a candidate for collection, ordered by key, starting after `cursor`, up to `limit` entries.
5. `writeCursorAndBatch(cursor, batch)`: Persists cursor advancement and batch state mutations atomically under a single lock acquisition.
6. Safe-open traversal: resolving paths component by component (verifying symlinks) before opening the final component.
7. Atomic JSON I/O using augmented `fsync` strategy.

## 5. Invariants
- **Atomic Renames:** `writeFileSync` → `fsync(fd)` → close fd → `rename` → `fsync(parentDir)` (F-11 fix).
- **Safe Open:** Final path components are atomically opened relative to the verified directory using `O_RDONLY` on the parent directory (F-10 fix).
- **Lock Encapsulation:** Only the Registry manages the `O_EXCL` lock directly (Option A).

## 6. Internal Operations
- Validates symlink boundaries and resolves paths.
- Enforces strict write-once creation for registry entries.

## 7. Cross-Cutting Concerns
- **Security:** Strict path confinement using safe-open. Rejects `..`, symlinks, or absolute path traversal attempts.

## 8. Infrastructure & Environment
- Environment: Unix-only filesystem semantics.

## 9. Dependencies
- `STD-TURNLOCK-PI-SUBAGENTS-PROTOCOL`

## 10. Testing Strategy
- Concurrency testing on lock files and symlink attack scenarios.

## 11. Glossary
- **TOCTOU:** Time-of-check to time-of-use race condition.

## 12. Failure Modes
- **Lock Acquisition EEXIST:** If the lock is held, read holder identity. If holder fails signed-challenge probe, throw `"registry-locked"` with details. Do not unlink (requires `recoverRegistry`).
- **fsync(parentDir) Failure:** If the final fsync fails after rename, the file is written but metadata isn't flushed. Recovery: OS flush on best effort. Next lock acquirer may see corrupted file and trigger recovery.
- **Torn Write on Crash:** Lock file is partially written. Recovery: Reader validates JSON. If corrupted, probe fails, requires `recoverRegistry`.

## 13. Idempotence & Cleanup
- **Idempotence Key:** Lock release uses inode comparison. `releaseLock()` checks current inode before unlinking to prevent unlinking a newly acquired lock.
- **Cleanup:** `releaseLock()` deletes the lock file explicitly.
