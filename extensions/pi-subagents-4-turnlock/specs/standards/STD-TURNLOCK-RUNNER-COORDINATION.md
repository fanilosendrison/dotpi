---
okf_version: "1.0"
kind: "KnowledgeAsset"
asset_type: "standard"
domain: "architecture"
severity: "strict"
name: "Turnlock Runner Coordination"
---

# 📋 STD-TURNLOCK-RUNNER-COORDINATION

## 1. Contextual Placement
Defines the architectural logic for the signed-challenge liveness probe protocol used by Turnlock Launchers and Orchestrators to determine process health independent of standard OS checks.

## 2. Signed-Challenge Liveness Probe Protocol
Standard OS checks (`kill(pid, 0)`) are insufficient because a process may be alive (e.g., zombie, stuck, deadlocked) but incapable of processing work.

### 2.1 The Challenge Request
The provider (orchestrator or stale reconciler) sends a UDP or TCP packet to the launcher's `livenessEndpoint` defined in its `ProcessInstanceIdentityV1`.
The request contains:
- `challengeNonce`: A securely generated random 32-byte string.

### 2.2 The Response
The launcher must respond within `ownerHeartbeatMs`. The response contains:
- `signature`: The HMAC-SHA256 of the `challengeNonce` combined with the launcher's `nonce` (from its identity).

### 2.3 Verification
The provider recalculates the expected signature using the identity's nonce.
- **Match:** The launcher is healthy.
- **Mismatch or Timeout:** The probe fails.

## 3. Usage
Consumed by `CDD-N-TURNLOCK-CLAIM-FENCE` (the launcher side) and `CDD-O-TURNLOCK-ORCHESTRATOR` (the provider side).
