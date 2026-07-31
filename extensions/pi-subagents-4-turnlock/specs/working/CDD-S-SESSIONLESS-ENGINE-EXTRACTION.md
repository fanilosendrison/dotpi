---
okf_version: "1.0"
kind: "RuntimeArtifact"
format: "cubits-design-doc"
workspace: "go"
date: "2026-07-21"
step_id: 0
id: CDD-S-SESSIONLESS-ENGINE-EXTRACTION
version: "1.0.0"
scope: pi-subagents-execution
status: draft
consumers: [agent-generator]
superseded_by: []
---

# 📋 CDD-S-SESSIONLESS-ENGINE-EXTRACTION

## 1. Objectif & Position
Concrete strategy to fulfill `CDD-I-SESSIONLESS-ENGINE` by extracting the existing execution loop out of `async-execution.ts`.

## 2. Goals & Non-Goals
**Goals:** Provide a drop-in execution module for Turnlock launchers using existing code.
**Non-Goals:** Does not rewrite the fundamental LLM execution logic, only its dependency injection.

## 3. Data Contracts
Implements `CDD-I-SESSIONLESS-ENGINE`.

## 4. Pipeline
1. The engine receives a `SessionlessContext` carrying all configuration previously obtained from `ExtensionAPI` — cwd, session identity, model selection, skill injection, and tool budgets are pre-resolved by the caller and passed as opaque configuration.
2. Agent execution proceeds independently of any Pi session. No `ctx.pi.events`, no `ctx.cwd`, no `ctx.currentSessionId` are accessed during execution.
3. Results are written as universal envelopes (`JobSuccessEnvelope` / `JobFailureEnvelope`) rather than emitted via Pi session events. The caller (Turnlock Launcher or existing async flow) is responsible for routing envelopes to the appropriate target paths.
4. The existing `AsyncExecutionContext` adapter delegates to `SessionlessContext` internally, wrapping the sessionless path so that the current async flow remains backward-compatible without code duplication.

## 5. Invariants
- The extracted code must pass the same unit tests as the current async flow.

## 6. Internal Operations
- The engine constructs an isolated execution context from pre-resolved configuration, with no ambient access to the Pi host session.
- Envelope routing is handled by the caller, not the engine — the engine produces envelopes, the caller decides where to write them.

## 7. Cross-Cutting Concerns
- Legacy compatibility.

## 8. Infrastructure & Environment
- Bun runtime.

## 9. Dependencies
- `CDD-I-SESSIONLESS-ENGINE`

## 10. Testing Strategy
- Regression testing the existing async flows against the refactored engine.

## 11. Glossary
- N/A

## 12. Failure Modes
- **LLM Timeout/Failure:** Handled by wrapping in `JobFailureEnvelope`.

## 13. Idempotence & Cleanup
- Execution logic remains idempotent based on `jobId`.
