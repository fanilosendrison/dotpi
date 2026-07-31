---
okf_version: "1.0"
kind: "RuntimeArtifact"
format: "cubits-design-doc"
workspace: "go"
date: "2026-07-21"
step_id: 0
id: CDD-N-TURNLOCK-CLAIM-FENCE
version: "1.0.0"
scope: turnlock-runner-coordination
status: draft
consumers: [agent-generator]
superseded_by: []
---

# 📋 CDD-N-TURNLOCK-CLAIM-FENCE

## 1. Objectif & Position
Manages the under-lock atomic claim and heartbeat fence checks to ensure launchers are alive and correctly fenced.

## 2. Goals & Non-Goals
**Goals:** Atomically register claims and provide heartbeat re-verification.
**Non-Goals:** Does not spawn the processes (delegated to Launcher) nor manage the lock file directly (delegated to Registry).

## 3. Data Contracts
Works with `ProcessInstanceIdentityV1` and consumes `registry.acquireLock()`.

## 4. Pipeline
1. `registry.acquireLock()`
2. Verify `fenceGeneration`. If `>= generation` → release, `exit(0)`.
3. Atomically write claim (transition from `spawn-intent` to `launcher-claimed`) and record `PGID` **under the lock**.
4. `registry.releaseLock()`
5. Start periodic heartbeat verification (transition to `running` when execution starts).

## 5. Invariants
- Claim and PGID recording must be part of a single atomic transaction under the lock to prevent fencing gaps.
- Heartbeats must auto-terminate before any I/O operation if fence generation increases.

## 6. Internal Operations
- Evaluates `ownerHeartbeatMs` against liveness responses.

## 7. Cross-Cutting Concerns
- **Security:** Process identity guarantees preventing unauthorized claim hijacking.

## 8. Infrastructure & Environment
- Environment: Unix-only.

## 9. Dependencies
- `CDD-N-TURNLOCK-REGISTRY`
- `STD-TURNLOCK-LIVENESS`

## 10. Testing Strategy
- Simulating suspended (SIGSTOP) launchers and verifying heartbeat fence termination.

## 11. Glossary
- **PGID:** Process Group ID.

## 12. Failure Modes
- **Heartbeat Loop Crash:** The liveness socket closes. The provider's signed-challenge probe fails. Provider treats launcher as indeterminate or dead.
- **Socket Unresponsiveness:** Same as above. The orchestrator will trigger stale-run reconciliation after the timeout.
- **Claim Rejected:** If `fenceGeneration >= generation`, the claim is rejected. Recovery: `exit(0)`.

## 13. Idempotence & Cleanup
- **Idempotence Key:** `generation` combined with `nonce`.
- **Cleanup:** Closes liveness socket on termination.
