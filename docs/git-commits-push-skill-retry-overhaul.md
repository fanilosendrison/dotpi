# Git Commits Push Skill — Retry Overhaul

## Where / What

The `git-commits-push` skill lives at `~/.agents/skills/git-commits-push/`. The plan that drove this work is at `docs/plans/unified-retry-on-all-catches.md` inside the skill repo.

## How It Works

The skill now classifies every error into one of 5 kinds (`validation`, `structural`, `race`, `git`, `network`) and retries LLM calls when the error is recoverable. Each kind has its own attempt budget (default: validation=2, others=1).

### Flow
1. Publisher errors (duplicate file, nonexistent file, missing file, diff hash mismatch, push failure) are caught by `classifyError()` and mapped to a retry kind.
2. LLM-side failures (JSON parse errors, network timeouts) are caught by `classifyLLMFailure()` and fail-closed (no retry) unless they match `"validation rejected"`.
3. Retry payloads are built by `queueRetry()` with:
   - Loop detection via SHA-256 of canonical plan structure
   - `pending_files` filtered against already-committed SHAs
   - `feedbackHistory` capped at 10 entries, 16KB each, 64KB total
   - Human-readable formatted commit messages instead of raw JSON
4. The orchestrator uses module-scope `retryJobs` queue (Decision 9) and accumulates `committedShas` from `PartialCommitError` and `CommitPlanError.context` (R59).
5. Duplicate file detection uses `path.posix.normalize()` + trailing slash removal (R56).

### Key Files

| File | Purpose | Versioned |
|------|---------|-----------|
| `src/modules/errors.ts` | Typed error hierarchy (CommitPlanError, DiffHashMismatchError, etc.) | ✅ |
| `src/modules/error-classifier.ts` | classifyError, getResolutionHint, classifyLLMFailure | ✅ |
| `src/modules/queue-retry.ts` | queueRetry, retryJobs, logRetry, reconstructRemainingDiff | ✅ |
| `src/modules/feedback-formatter.ts` | Pure function to render feedback blocks for LLM | ✅ |
| `src/modules/git-publisher.ts` | executeMultiCommitAndPush with typed errors, path normalization, mid-loop handling | ✅ |
| `src/modules/reporter.ts` | buildReport + generateReport with committedShas, attempts, loopDetected | ✅ |
| `src/entrypoints/turnlock-orchestrator.ts` | Orchestrator with retry classification, queueRetry integration | ✅ |
| `src/entrypoints/turnlock-to-llm-bridge.ts` | Bridge using formatFeedbackBlock, shared types, no diff duplication | ✅ |
| `system-prompt.md` | Instructions for LLM (Interpreting Feedback section removed as redundant) | ✅ |

## Background

Originally only validation errors triggered an LLM retry. All other failures (duplicate files, missing files, push failures, git errors) were fail-closed. This plan extended the retry mechanism to all LLM-recoverable error categories, added partial commit instrumentation, loop detection, structured feedback formatting, and an enriched execution report.

The escalation channel (status ESCALATED, EscalationContext) was removed as unnecessary — the parent agent cannot manually intervene because git commit is always intercepted by the skill.

### Retry budgets

| Kind | Default max | Rationale |
|------|-------------|----------|
| `validation` | 2 | LLM sometimes misses subject length rules on first try |
| `structural` | 1 | Plan structure errors are clear, rarely need retry |
| `race` | 1 | Diff changed during inference — rare |
| `git` | 1 | Git execution failure — usually fatal |
| `network` | 1 | Transient push failure — one retry is enough |
