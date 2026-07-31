---
okf_version: "1.0"
kind: "RuntimeArtifact"
format: "cubits-design-doc"
workspace: "go"
date: "2026-07-21"
step_id: 0
id: CDD-N-TURNLOCK-LAUNCHER
version: "1.0.0"
scope: turnlock-runner-coordination
status: draft
consumers: [agent-generator]
superseded_by: []
---

# 📋 CDD-N-TURNLOCK-LAUNCHER

## 1. Objectif & Position
Manages the Turnlock launcher spawn, PGID tracking, and stop signals.

## 2. Goals & Non-Goals
**Goals:** Spawn processes reliably, isolate them via PGIDs, and guarantee clean termination.
**Non-Goals:** Does not manage the registry lock or heartbeat fences directly.

## 3. Data Contracts
**Input:** `ResolvedJobPlanV2[]` — the batch of job plans to execute.

```typescript
type WorkspaceInputCommitmentV1 = {
  readonly hash: string;
  readonly method: "sha256";
};

interface WorkspaceBindingV2 {
  readonly workspaceInputCommitment: WorkspaceInputCommitmentV1;
  readonly workspaceDigest: string;
}

interface ResolvedJobPlanV2 {
  readonly jobId: string;
  readonly agentName: string;
  readonly agentConfigDigest: string;
  readonly task: string;
  readonly modelSelector: string;
  readonly fallbackPolicy: readonly string[];
  readonly requestedThinking?: string;
  readonly toolBudget?: { maxTokens: number };
  readonly permissionProfileDigest?: string;
  readonly configuredExtensionDigests: readonly string[];
  readonly targetRef: ArtifactTargetRefV1;
  readonly resultContractDigest?: string;
  readonly executorSpecDigest: string;
}

interface ResolvedExecutionPlanV2 {
  readonly version: 1;
  readonly workspaceBinding: WorkspaceBindingV2;
  readonly resourcePolicyDigest: string;
  readonly environmentProfileDigest: string;
  readonly concurrency: number;
  readonly deadlineAtEpochMs: number;
  readonly deadlineReserveMs: number;
  readonly maxConcurrentLaunches: number;
  readonly jobs: readonly ResolvedJobPlanV2[];
  readonly agentSnapshots: Record<string, unknown>;
}
```

**Mapping to Sessionless Engine:** For each `ResolvedJobPlanV2`, the Launcher constructs the `ResolvedExecutionPlanV2` consumed by `CDD-I-SESSIONLESS-ENGINE`: it looks up `agentSnapshots[job.agentName]` from the plan snapshot map (keyed by agent name, digest-matched against `job.agentConfigDigest`), and passes the job + snapshot pair. Single-job launches map to `executeSessionlessSingle`; multi-job batches map to `executeSessionlessChain`.

**Output:** Universal Envelopes (`JobSuccessEnvelope` / `JobFailureEnvelope`) written to `ArtifactTargetRefV1` paths via safe-open traversal.
*(Note: Envelope format per STD-TURNLOCK-PI-SUBAGENTS-PROTOCOL §2.7, includes `JobResultEnvelopeHeader` + status-specific fields)*

## 4. Pipeline
1. Parse Turnlock env vars.
2. Delegate claim protocol and liveness socket to `CDD-N-TURNLOCK-CLAIM-FENCE`.
3. Execute agent instructions via sessionless engine (`CDD-I-SESSIONLESS-ENGINE`).
4. Stop uses targeted `SIGTERM`/`SIGKILL` on the persisted PGID.

## 5. Invariants
- Spawn must strictly use the sessionless execution engine.

## 6. Internal Operations
- Iterates survivors using `pgrep -g <pgid>` to track orphans.

## 7. Cross-Cutting Concerns
- **Security:** Strict process isolation within process groups.

## 8. Infrastructure & Environment
- Environment: Strictly Unix-only. `process.getpgid(0)`, `pgrep`, and POSIX signals have no Windows equivalent.

## 9. Dependencies
- `CDD-N-TURNLOCK-CLAIM-FENCE`
- `CDD-I-SESSIONLESS-ENGINE`

## 10. Testing Strategy
- Spawning tree of processes and ensuring PGID-based `SIGKILL` reaps all children.

## 11. Glossary
- **PGID:** Process Group ID.

## 12. Failure Modes
- **Unresolved Orphans:** If `pgrep -g <pgid>` returns a non-empty list after `SIGKILL`, the node throws `"unresolved-orphans"`. Recovery: Administrator intervention or system reboot is required, as the process tree is unkillable.
- **Spawn Failure:** OS fails to fork/spawn. Recovery: Reconciler marks as terminal failure.

## 13. Idempotence & Cleanup
- **Idempotence Key:** The `PGID` is unique per run execution.
- **Cleanup:** `stopRequestMs` timeout enforces clean exit before `SIGKILL`.
