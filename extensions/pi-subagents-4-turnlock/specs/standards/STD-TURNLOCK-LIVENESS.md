---
okf_version: "1.0"
kind: "KnowledgeAsset"
asset_type: "standard"
domain: "architecture"
severity: "strict"
name: "Turnlock Liveness Protocol"
---

# 📋 STD-TURNLOCK-LIVENESS

## 1. Contextual Placement
Defines the timeout and lease mechanisms built on top of the `STD-TURNLOCK-RUNNER-COORDINATION` signed-challenge probe.

## 2. Indeterminate Liveness
If a launcher fails the signed-challenge probe (timeout or bad signature) but its PID is still active in the OS (`kill(pid, 0)` succeeds), it enters the **Indeterminate** state.

## 3. The Fence Lease Timeout
A launcher cannot be allowed to hold resources indefinitely if it is indeterminate.

**Normative Constant:**
`fenceLeaseTimeoutMs = 900_000` (15 minutes)

**Derivation:**
`3 × max(ownerHeartbeatMs, networkRTT_p99) + deadlineReserveMs`
This provides a conservative upper bound preventing a transient network hiccup from triggering a fence, while ensuring a true deadlock is eventually broken.

**Protocol:**
If the launcher remains in the indeterminate state for longer than `fenceLeaseTimeoutMs`, the provider MAY fence the process (e.g., via SIGKILL to its PGID) and release its lock/claims, treating the launcher as Byzantine.
