---
okf_version: "1.0"
kind: "RuntimeArtifact"
format: "implementation-design"
workspace: "pi-subagents-4-turnlock"
date: "2026-07-21"
step_id: 0
id: "PROTO-CDD-PI-SUBAGENTS-TURNLOCK-IMPL"
version: "0.5.0"
scope: "turnlock-integration-implementation"
status: "draft"
consumers:
  - "pi-subagents-4-turnlock"
referenced_by:
  - "CDD-S-PI-SUBAGENTS-EXECUTION"
---

# Implementation Design — Turnlock Integration for pi-subagents

## 0. Purpose

Implementation design consuming `STD-TURNLOCK-PI-SUBAGENTS-PROTOCOL` v0.3.0.
All types referenced from the protocol standard; this document defines only
implementation-private structures.

### 0.1 Prerequisites

The sessionless execution engine has been extracted from `async-execution.ts`
as exported functions `executeSessionlessChain`, `executeSessionlessSingle`
and types `SessionlessContext`, `SessionlessPathOverrides` in
`src/runs/background/async-execution.ts`. This engine:

- Receives agent snapshots and a `SessionlessContext` (no `ExtensionAPI`)
- Accepts `SessionlessPathOverrides` for Turnlock-injected paths and env vars
- Is importable by both the Turnlock launcher and the existing Pi async flow

### 0.2 Topology

```
Turnlock Runner (Bun)
  └─ Pi strategy adapter
      └─ import "pi-subagents/turnlock"
          ├─ Registry (O_EXCL + ProcessInstanceIdentityV1)
          ├─ LauncherManager (PGID-tracked, signed-challenge liveness)
          ├─ ClaimFence (under-lock atomic, heartbeat re-verification)
          ├─ ResultCollector (cursor-based, tombstone with double retention)
          └─ StaleRunReconciler (indeterminate = not dead)
```

---

## 1. Module Structure

```
pi-subagents/
  index.ts
  turnlock/
    index.ts                  ← createTurnlockIntegration(), recoverRegistry()
    registry.ts               ← O_EXCL lock + atomic JSON
    launcher.ts               ← spawn, PGID tracking, stop
    claim-fence.ts            ← under-lock claim + heartbeat fence check
    result-collector.ts       ← cursor-based, lifecycle-managed
    sessionless-engine.ts     ← extracted in async-execution.ts (see §0.1)
    stale-reconciler.ts       ← extended reconciler
    safe-path.ts              ← per-component no-follow traversal
    errors.ts                 ← TurnlockIntegrationError (references STD codes)
    types.ts                  ← internal types only
```

---

## 2. Registry

### 2.1 Coordination (F-01, F-02)

O_EXCL lock with `ProcessInstanceIdentityV1` from `STD-TURNLOCK-RUNNER-COORDINATION`.
Liveness verified via signed-challenge probe, not `kill(pid, 0)`.

**Lock acquisition:**

```typescript
class RegistryLock {
  acquire(root: string, policy: DelegationResourcePolicyV2): void {
    // O_EXCL open, write ProcessInstanceIdentityV1, fsync
    // On EEXIST: read holder identity
    //   If holder identity fails signed-challenge probe → stale
    //   Throw "registry-locked" with holderIdentity in details
    //   (Do NOT unlink. recovery via recoverRegistry().)
    // Retry up to policy.lockTimeoutMs
  }

  release(): void {
    // inode = fs.fstatSync(this.fd).ino
    // currentInode = fs.statSync(this.path).ino
    // if (inode !== currentInode) → do NOT unlink (replaced)
    // fs.closeSync(this.fd)
    // fs.unlinkSync(this.path)
  }
}
```

**recoverRegistry (F-02):**

```typescript
function recoverRegistry(proofOfDeath: ArtifactCommitmentV2): { recovered: boolean } {
  // Read lock file → extract holder ProcessInstanceIdentityV1
  // Validate proofOfDeath against holder identity
  // If valid AND holder fails liveness probe:
  //   unlink lock file, initialize recovery
  //   return { recovered: true }
  // return { recovered: false }
}
```

### 2.2 File format (F-04a, F-06)

```typescript
interface RegistryFileV2 {
  readonly version: 2;
  readonly policyDigest: string;
  readonly collectorCursor?: string;   // F-06: last processed entry key
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
  // F-04a: paths relative to registryRoot
  readonly relativeAsyncDir: string;
  readonly relativeResultNamespace: string;
  // F-03: process group identity
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
  readonly state: JobState;
  readonly targetRef: ArtifactTargetRefV1;
  readonly resultCommitment?: ArtifactCommitmentV2;
  readonly terminalAtEpochMs?: number;
  // F-06: per-artifact retention states
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

### 2.3 Atomic I/O

`writeAtomicJson` augmented: `fsync(temp)` → `rename` → `fsync(parentDir)`.

---

## 3. Resolved Execution Plan

### 3.1 Plan structure

```typescript
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
  readonly agentSnapshots: Record<string, AgentConfigSnapshot>;
  // Artifact root bindings provided by Turnlock adapter at initialization
}

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
  readonly toolBudget?: ResolvedToolBudgetV2;
  readonly permissionProfileDigest?: string;
  readonly configuredExtensionDigests: readonly string[];
  readonly targetRef: ArtifactTargetRefV1;
  readonly resultContractDigest?: string;
  readonly executorSpecDigest: string;
}
```

### 3.2 Path resolution (F-04b)

All paths are resolved relative to `registryRoot`. The implementation
provides `ArtifactRootBindingV1` mappings (e.g., `"turnlock-run"` →
`registryRoot`) at initialization time.

**Safe-open traversal:** Before writing to a `rawResultTarget`, resolve the
path component by component. For each component from the root:
1. Verify the component is not `..` and contains no `/` or `\0`.
2. Construct the intermediate path.
3. `fs.statSync` the intermediate path.
4. If `stat.isSymbolicLink()` → reject (symlink anywhere in chain).
5. Continue to next component.
6. For the final component: `fs.openSync(path, "wx", 0o600)` — this also
   enforces write-once (fails if exists).

No `realpathSync` (follows symlinks). No `O_NOFOLLOW` on the final component
alone (doesn't protect parent directories).

---

## 4. Claim Fencing (F-03)

### 4.1 Under-lock atomic claim

Child startup under coordination lock (same as §2.1):

1. Acquire lock.
2. Read `fenceGeneration`. If `>= generation` → release, exit(0).
3. Write claim: `ProcessInstanceIdentityV1` + generation + nonce +
   livenessEndpoint. `fsync`.
4. Release lock.
5. Record `PGID` (`process.getpgid(0)`) in registry.

### 4.2 Heartbeat fence re-verification

Child runs a periodic heartbeat (interval = `ownerHeartbeatMs / 3`):

1. Respond to parent's signed-challenge probe via liveness socket.
2. Re-acquire lock (non-blocking try).
3. Read `fenceGeneration`. If `>= generation`: release lock, auto-terminate
   before any I/O operation.
4. Release lock.

This prevents the scenario where G1 is suspended (SIGSTOP), G2 fences and
spawns, then G1 resumes: G1's next heartbeat detects the fence and exits.

### 4.3 Indeterminate liveness

A launcher that misses heartbeats but whose PID is still alive is
**indeterminate** — not dead. The provider MUST NOT fence. The caller may:

- Call `stopLaunch` (SIGKILL to the PGID) → guaranteed termination.
- Wait for the launcher to resume heartbeats.
- If the PID eventually dies → stale-run reconciliation declares it dead.

---

## 5. Launcher Process Management

### 5.1 Spawn (F-04c)

Uses the sessionless engine from `async-execution.ts` (§0.1):

1. Map `ResolvedJobPlanV2[]` to engine input format.
2. Pass Turnlock env vars: `PI_TURNLOCK_LAUNCH_KEY`, `PI_TURNLOCK_GENERATION`,
   `PI_TURNLOCK_NONCE`, `PI_TURNLOCK_REGISTRY_ROOT`.
3. Child entry point (`turnlock/launcher-entry.ts`):
   a. Parse env vars.
   b. Execute claim protocol (§4.1).
   c. Open liveness socket for signed-challenge probe.
   d. Start heartbeat loop (§4.2).
   e. Execute agent instructions via sessionless engine.
   f. Write result envelopes to `ArtifactTargetRefV1` paths (via safe-open).

### 5.2 Stop (F-03)

Target the persisted `PGID`:
1. SIGTERM → `-pgid`.
2. Wait `stopRequestMs`.
3. SIGKILL → `-pgid`.
4. Wait `stopRequestMs`.
5. `pgrep -g <pgid>` → iterate survivors, test liveness.
6. Survivors after `stopReconciliationMs` → `unresolvedOrphans`.

---

## 6. Result Envelopes

### 6.1 Universal envelope

Per STD §6. Launcher writes `JobSuccessEnvelope` / `JobFailureEnvelope`.
Reconciler writes `JobFailureEnvelope` for launcher-died cases.
Stop handler writes `JobStoppedEnvelope`.

### 6.2 Path confinement (F-04b)

All result writes use safe-open traversal (§3.2). `..` rejected at resolution.
Symlinks rejected at any path component.

### 6.3 Integrity

`readJobResult`: SHA-256 of file bytes. Mismatch with `resultCommitment` →
`"integrity-conflict"`. Never update the registry's commitment silently.

---

## 7. Retention Lifecycle (F-06)

### 7.1 Per-artifact states

```
terminal → receipt → delete-intent → deleted → tombstone
```

- **receipt**: `acknowledgeRetention` recorded.
- **delete-intent**: Collector will delete.
- **deleted**: File removed.
- **tombstone**: Expiry set to
  `earliestCleanupAtEpochMs + max(retentionFloorMs, terminalRetentionDays × 86_400_000)`.
  Entry removed after expiry.

### 7.2 Cursor-based collector

```typescript
class ResultCollector {
  private timer: NodeJS.Timeout | null = null;
  private disposed = false;

  start(policy: DelegationResourcePolicyV2): void {
    this.timer = setInterval(() => this.collect(), policy.observationPollMs);
    this.timer.unref();
  }

  private collect(): void {
    if (this.disposed) return;
    const lock = this.registry.acquireLock();
    try {
      const cursor = this.registry.readCursor();
      const batch = this.registry.scanRetentionCandidates(cursor, 100);
      let dirty = false;
      for (const entry of batch) {
        for (const [jobId, job] of Object.entries(entry.jobs)) {
          // 1. Transition receipt → delete-intent (persist BEFORE unlink)
          if (job.retentionState === "receipt" &&
              Date.now() >= job.retentionReceipt!.earliestCleanupAtEpochMs) {
            job.retentionState = "delete-intent";
            job.deleteIntentAtEpochMs = Date.now();
            dirty = true;
          }
        }
      }
      // Persist delete-intent transitions before any unlink
      if (dirty) this.registry.writeBatch(batch);
      // 2. Delete files for delete-intent jobs, then persist deleted
      dirty = false;
      for (const entry of batch) {
        for (const [jobId, job] of Object.entries(entry.jobs)) {
          if (job.retentionState === "delete-intent") {
            try { fs.unlinkSync(this.resolveTarget(job.targetRef)); }
            catch (err) { if (err.code !== "ENOENT") throw err; }
            job.retentionState = "deleted";
            job.deletedAtEpochMs = Date.now();
            dirty = true;
          }
        }
        // 3. Transition deleted → tombstone when all jobs done
        if (Object.values(entry.jobs).every(j =>
            j.retentionState === "deleted" || j.retentionState === "tombstone")) {
          for (const job of Object.values(entry.jobs)) {
            if (job.retentionState === "deleted") {
              job.retentionState = "tombstone";
              job.tombstoneExpiryAtEpochMs =
                Date.now() +
                Math.max(policy.retentionFloorMs,
                         policy.terminalRetentionDays * 86_400_000);
              dirty = true;
            }
          }
        }
      }
      // 4. Persist cursor + deleted states atomically (after unlink)
      if (dirty || batch.length > 0) {
        this.registry.writeCursorAndBatch(batch.lastKey, batch);
      }
    } finally {
      lock.release();
    }
  }

  dispose(): void {
    this.disposed = true;
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }
}
```

### 7.3 Crash safety

Registry shows: receipt, some delete-intent, some deleted. Collector resumes
from cursor. `acknowledgeRetention` retry → existing receipt → success.
`readJobResult` for tombstoned job → `"job-not-found"` with
`details: { reason: "released" }`.

---

## 8. Stale-Run Reconciliation

Extends existing reconciler to update the durable registry. Called by
`inspectLaunch` on `"launcher-claimed"` or `"running"` with dead PID.

- Liveness timeout on live PID → indeterminate. Do NOT reconcile.
- Ambiguous evidence → `"ambiguity"` error. Caller quarantines.
- Clear evidence (result files present/absent, PID dead) → determine terminal
  state, write envelopes for unenveloped jobs, update registry.

---

## 9. Error Implementation

```typescript
class TurnlockIntegrationError extends Error {
  readonly apiVersion = "turnlock-pi-subagents-v1";
  readonly code: ProtocolErrorCode;   // from STD §2.6
  readonly details?: unknown;
  readonly evidenceCommitment?: ArtifactCommitmentV2;
}
```

Uses `ProtocolErrorCode` directly from the STD. `message` ≤ 200 Unicode scalars.

---

## 10. Migration Notes

### 10.1 Prerequisites

| Item | Status |
| ---- | ------ |
| Sessionless execution engine | Extracted in `src/runs/background/async-execution.ts` — `executeSessionlessChain`, `executeSessionlessSingle` |
| `writeAtomicJson` fsync augmentation | Extend existing helper |
| Signed-challenge liveness probe | Implement per `STD-TURNLOCK-RUNNER-COORDINATION` §5 |
| Per-component safe-open traversal | New module `turnlock/safe-path.ts` |

### 10.2 Code reuse

| Existing module | Reused by |
| --------------- | --------- |
| `src/shared/atomic-json.ts` | Registry (+ fsync) |
| `src/runs/background/stale-run-reconciler.ts` | Extended for registry updates |

### 10.3 Watcher non-interference

Turnlock results written outside `RESULTS_DIR`. Watcher unchanged.

---

## A. Field Mapping: STD v0.3.0 → Implementation

| STD § | Requirement | Location |
| ----- | ----------- | -------- |
| §2.1–§2.8 | All type definitions | Referenced directly; `types.ts` for internal only |
| §3.1 | `capabilities()` | `index.ts` |
| §3.2 | `launchStaticGroup` | `Registry` + `ClaimFence` |
| §3.3 | `inspectLaunch` | `Registry` + `StaleRunReconciler` |
| §3.4 | `readJobResult` | `Registry` |
| §3.5 | `stopLaunch` (PGID) | `LauncherManager` |
| §3.6 | `acknowledgeRetention` | `Registry` + `ResultCollector` |
| §3.7 | `recoverRegistry` | `Registry.recoverRegistry()` |
| §4.2 | Claim+fence under lock + heartbeat | `ClaimFence` + `launcher-entry.ts` |
| §4.3 | PGID persistence | `RegistryEntryV2.processGroupId` |
| §5.1 | O_EXCL + identity + safe release | `RegistryLock` |
| §5.2 | PGID-based stop | `LauncherManager.stop()` |
| §6.1 | Universal envelope | Launcher + reconciler + stop handler |
| §7.1 | Per-artifact retention states | `RegistryJobEntryV2.retentionState` |
| §7.2 | Cursor-based collector | `ResultCollector` |
| §9 | Error codes | `errors.ts` using `ProtocolErrorCode` |
