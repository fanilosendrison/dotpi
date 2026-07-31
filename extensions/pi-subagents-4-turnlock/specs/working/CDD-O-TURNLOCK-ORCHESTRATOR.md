---
okf_version: "1.0"
kind: "RuntimeArtifact"
format: "cubits-design-doc"
workspace: "go"
date: "2026-07-21"
step_id: 0
id: CDD-O-TURNLOCK-ORCHESTRATOR
version: "1.0.0"
scope: turnlock-runner-coordination
status: draft
consumers: [agent-generator]
superseded_by: []
---

# 📋 CDD-O-TURNLOCK-ORCHESTRATOR

## 1. Objectif & Position
The orchestrator acts as the DAG controller for Turnlock subagent execution. It delegates execution to the registry, launchers, and collectors.

## 2. Goals & Non-Goals
**Goals:** Coordinate the lifecycle of Turnlock subagents in a fail-closed manner. Define the exact DAG topology.
**Non-Goals:** It does not directly mutate the registry file or spawn processes itself. It delegates these tasks.

## 3. Data Contracts
Depends on `ResolvedExecutionPlanV2` and `ProcessInstanceIdentityV1`.

## 4. Pipeline
**DAG Topology:**
```text
  [Registry Init] → [Claim-Fence] → [Launcher spawn*] → [Result Collector] → [Stale Reconciler]
                                  ↕ (heartbeat loop)
```

**Join Rules:**
- `Registry Init`: Executes once sequentially.
- `Launcher spawn`: Executes in parallel bounded by `maxConcurrentLaunches`.
- `Claim-Fence`: Executes once sequentially before all Launcher spawns. Each launcher carries its own heartbeat sidecar loop.
- `Result Collector`: Runs continuously (timer-based) in the background.
- `Stale Reconciler`: Runs on-demand triggered by `inspectLaunch` on dead PIDs.

## 5. Invariants
- **Fail-Closed:** Execution must fail-closed if any node cannot acquire its required resources.
- **DAG Linearization:** Nodes execute in the topological order defined in §4. No downstream node starts before its upstream predecessor completes.
- **Parallel Launcher Bound:** At most `maxConcurrentLaunches` launcher instances execute concurrently.
- **Heartbeat Liveness:** The Claim-Fence heartbeat loop runs for the entire lifetime of each launcher. A missed heartbeat beyond `fenceLeaseTimeoutMs` triggers fencing.
- **Collector Monotonicity:** The collector cursor advances strictly forward. A collector cycle never revisits entries already transitioned past the cursor.
- **Reconciler Idempotence:** Reconciling an already-terminal run is a no-op.

## 6. Internal Operations
- Orchestrates the high-level `createTurnlockIntegration()` and `recoverRegistry()` paths.

## 7. Cross-Cutting Concerns
- **Security:** Relies on registry encapsulation for file system safety.

## 8. Infrastructure & Environment
- Environment: Unix-only (Linux kernel ≥ 5.x, macOS ≥ 13).

## 9. Dependencies
- `STD-TURNLOCK-PI-SUBAGENTS-PROTOCOL`
- `STD-TURNLOCK-RUNNER-COORDINATION`
- `CDD-N-TURNLOCK-REGISTRY`
- `CDD-N-TURNLOCK-CLAIM-FENCE`
- `CDD-N-TURNLOCK-LAUNCHER`
- `CDD-N-TURNLOCK-RESULT-COLLECTOR`
- `CDD-N-TURNLOCK-RECONCILER`

## 10. Testing Strategy
- Integration tests simulating orchestrator behavior with mocked nodes.

## 11. Glossary
- **DAG:** Directed Acyclic Graph used for phase execution.

## 12. Failure Modes
- **Registry Init Fails:** Wait and retry up to `lockTimeoutMs`. Recovery: Throw `"registry-locked"`.
- **Launcher Spawn Crash:** Delegate to `CDD-N-TURNLOCK-RECONCILER`.
- **Collector Failure:** Timer loop fails. Recovery: Log error, next timer tick attempts to recover. No data loss due to registry atomicity.

## 13. Idempotence & Cleanup
- **Idempotence Key:** `requestDigest`. Re-running the orchestrator with the same plan yields the same registry entries.
- **Cleanup:** Result collector handles async deletion of old runs based on tombstone logic.
