---
okf_version: "1.0"
kind: "RuntimeArtifact"
format: "cubits-design-doc"
workspace: "go"
date: "2026-07-21"
step_id: 0
id: CDD-N-TURNLOCK-RESULT-COLLECTOR
version: "1.0.0"
scope: turnlock-runner-coordination
status: draft
consumers: [agent-generator]
superseded_by: []
---

# 📋 CDD-N-TURNLOCK-RESULT-COLLECTOR

## 1. Objectif & Position
Manages the cursor-based garbage collection and per-artifact retention lifecycle.

## 2. Goals & Non-Goals
**Goals:** Atomically step through retention states and safely delete result artifacts.
**Non-Goals:** It does not reconcile stale runs or spawn tasks.

## 3. Data Contracts
Works with `RetentionReceiptV2` and retention states defined in `RegistryJobEntryV2`.
Consumes `registry.acquireLock()`.

## 4. Pipeline
**Retention FSM:**
```text
  terminal → receipt (on acknowledgeRetention)
  receipt → delete-intent (when now >= earliestCleanupAtEpochMs)
  delete-intent → deleted (after unlink succeeds)
  deleted → tombstone (when all jobs in entry are deleted/tombstoned)
  tombstone → removed (when now >= tombstoneExpiryAtEpochMs)
```
**Tombstone Expiry Formula:**
`earliestCleanupAtEpochMs + max(retentionFloorMs, terminalRetentionDays × 86_400_000)`

**Collection Loop:**
1. Call `registry.acquireLock()`.
2. Read cursor and scan retention candidates.
3. Persist `delete-intent` transitions BEFORE any unlink.
4. Delete files for `delete-intent` jobs, then persist `deleted`.
5. Transition to `tombstone`.
6. Atomically persist cursor + states via `registry.writeCursorAndBatch()`.

## 5. Invariants
- Delete-intent must be persisted to the registry *before* the file is unlinked.

## 6. Internal Operations
- Executes asynchronous batch operations and unlinking.

## 7. Cross-Cutting Concerns
- **Security:** Collector runs with privileges to unlink result artifacts across all namespaces.

## 8. Infrastructure & Environment
- Environment: Unix-only filesystem semantics.

## 9. Dependencies
- `CDD-N-TURNLOCK-REGISTRY`

## 10. Testing Strategy
- Force-crashing the collector at each state transition and ensuring no artifacts are leaked.

## 11. Glossary
- **Tombstone:** Expired state waiting for final sweep.

## 12. Failure Modes
- **Corrupted Cursor:** The collector reads an invalid cursor string. Recovery: Reset cursor to start of registry.
- **EACCES on unlink:** Permission denied to delete an artifact. Recovery: Retain in `delete-intent`, log error. Requires administrator intervention.
- **Crash during delete:** If crashed between delete and state update, retry is safe since `unlink` with ENOENT is ignored.

## 13. Idempotence & Cleanup
- **Idempotence Key:** `unlinkSync` gracefully catches `ENOENT` to allow idempotent retries of the `delete-intent` → `deleted` transition.
- **Cleanup:** Clears timer interval on disposal.
