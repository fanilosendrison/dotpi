---
okf_version: "1.0"
kind: "RuntimeArtifact"
format: "cubits-design-doc"
workspace: "go"
date: "2026-07-21"
step_id: 0
id: CDD-I-SESSIONLESS-ENGINE
version: "1.0.0"
scope: pi-subagents-execution
status: draft
consumers: [agent-generator]
superseded_by: []
---

# 📋 CDD-I-SESSIONLESS-ENGINE

## 1. Objectif & Position
Defines the architectural contract for the sessionless execution engine. This engine acts as the pure boundary between the Pi Subagents async execution flow and any Turnlock (or other) launcher integrations.

## 2. Goals & Non-Goals
**Goals:** Define an execution boundary that depends solely on fully resolved plans and agent snapshots.
**Non-Goals:** It does not orchestrate Turnlock locking, PGIDs, or process spawns.

## 3. Data Contracts

```typescript
type AgentConfigSnapshot = Record<string, unknown>;
```

**Inputs:** `ResolvedExecutionPlanV2`, `AgentConfigSnapshot`.
**Outputs:** Universal Envelopes (`JobSuccessEnvelope`, `JobFailureEnvelope`).

## 4. Invariants
- **Session Isolation:** MUST NOT depend on `ExtensionAPI`, `ctx.pi.events`, `ctx.cwd`, or `ctx.currentSessionId`. The execution must be completely stateless with respect to the Pi host session.

## 5. Internal Operations
- Abstract.

## 6. Cross-Cutting Concerns
- **Security:** Execution relies on provided capabilities without ambient access.

## 7. Infrastructure & Environment
- Environment-agnostic interface.

## 8. Dependencies
- `STD-TURNLOCK-PI-SUBAGENTS-PROTOCOL`

## 9. Testing Strategy
- Mock testing with static plans.

## 10. Glossary
- **Sessionless:** Completely decoupled from the primary interactive Pi session.

## 11. Failure Modes
- (Strategy Dependent)

## 12. Idempotence & Cleanup
- (Strategy Dependent)
