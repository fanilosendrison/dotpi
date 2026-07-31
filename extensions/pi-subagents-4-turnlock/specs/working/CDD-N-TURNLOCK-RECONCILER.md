---
okf_version: "1.0"
kind: "RuntimeArtifact"
format: "cubits-design-doc"
workspace: "go"
date: "2026-07-21"
step_id: 0
id: CDD-N-TURNLOCK-RECONCILER
version: "1.0.0"
scope: turnlock-runner-coordination
status: draft
consumers: [agent-generator]
superseded_by: []
---

# 📋 CDD-N-TURNLOCK-RECONCILER

## 1. Objectif & Position
Extends the existing reconciler to update the durable registry and detect stale-run states.

## 2. Goals & Non-Goals
**Goals:** Reconcile stale runs, declare ambiguous states, and manage envelopes for dead launchers.
**Non-Goals:** Does not interfere with live processes.

## 3. Data Contracts
Consumes `JobFailureEnvelope` and Turnlock error codes.
Works with `ProcessInstanceIdentityV1`.
*(Note: Envelope format per STD-TURNLOCK-PI-SUBAGENTS-PROTOCOL §2.7, includes `JobResultEnvelopeHeader` + status-specific fields)*

## 4. Pipeline
**Evidence Taxonomy:**
- **Indeterminate:** PID alive, heartbeats missed → do NOT reconcile.
- **Ambiguous:** PID dead, no result files, `status.json` missing or corrupted → error with `"ambiguity"`.
- **Terminal success:** PID dead, `JobSuccessEnvelope` present → mark complete.
- **Terminal failure:** PID dead, `JobFailureEnvelope` present OR no envelopes + no result files → mark failed, write synthetic `JobFailureEnvelope`.

1. Invoked by orchestrator on dead PID detection.
2. If ambiguous evidence → emit `"ambiguity"` error.
3. If clear evidence → determine terminal state, write synthetic envelopes if needed, and update registry state.

## 5. Invariants
- Must never reconcile an **indeterminate** process.

## 6. Internal Operations
- Safely writes universal envelopes for unenveloped jobs when a launcher dies abruptly.

## 7. Cross-Cutting Concerns
- Safely decoupling process death from logical job state.

## 8. Infrastructure & Environment
- Environment: Unix-only process signals.

## 9. Dependencies
- `CDD-N-TURNLOCK-REGISTRY`
- `STD-TURNLOCK-PI-SUBAGENTS-PROTOCOL`

## 10. Testing Strategy
- Simulating launcher SIGKILLs and validating reconciler successfully updates registry.

## 11. Glossary
- **Stale-Run:** A run where the launcher PID is dead but registry indicates it is active.

## 12. Failure Modes
- **Concurrent Reconciler Race:** Two orchestrators attempt to reconcile the same stale run. Recovery: `registry.acquireLock()` prevents race. The second reconciler reads the already-terminal state and no-ops.
- **Synthetic Envelope Write Fails:** Disk is full or permissions error. Recovery: Run remains marked as running, next reconciliation pass will retry.

## 13. Idempotence & Cleanup
- **Idempotence Key:** Reconciling an already terminal run does nothing.
- **Cleanup:** Reconciler is short-lived per invocation.
