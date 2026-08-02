# Upstream patch: `nicobailon/pi-subagents`

## `fix-dynamic-fanout-timeout-acceptance.patch`

- **Target**: `nicobailon/pi-subagents` at `v0.40.0`
- **File**: `src/runs/background/subagent-runner.ts`
- **Status**: not yet submitted upstream

### What

When a dynamic fanout group times out or is stopped, its aggregated acceptance ledger was
set to `undefined`. Individual agent steps correctly receive a
`buildSkippedAcceptanceLedger` (lines ~1538-1542 in the same file), but the two dynamic
group branches (empty group and populated group) bypassed this and returned `undefined`,
causing callers to lose visibility into the reason the acceptance was skipped.

### Fix

Replace `undefined` with a proper skipped-acceptance ledger in both dynamic group branches
(labels `"stopped"` and `"timeout"`), matching the individual-agent pattern.

### How to apply

```bash
git clone https://github.com/nicobailon/pi-subagents.git
cd pi-subagents
git checkout v0.40.0   # or the relevant base
git apply /path/to/fix-dynamic-fanout-timeout-acceptance.patch
```

### How to submit

1. Create a branch and commit the fix.
2. Also update `test/integration/async-execution.test.ts` in the test
   `"cancels dynamic fanout aggregate acceptance when the run times out"`:
   - Replace `timeoutMs: 1_000` with a safe value (e.g. `60_000`).
   - Use `deliverTimeoutRequest` after the dynamic child reaches `"completed"`
     to make the timeout deterministic.
   - Change the assertion `acceptance === undefined` to verify a rejected
     ledger (`status: "rejected"`, `runtimeChecks` contains `timeout: failed`).
3. Open a PR against `nicobailon/pi-subagents`.

### Context

- Discovered during testing of the Turnlock-forked variant (`pi-subagents-4-turnlock`
  in the `dotpi` repo).
- The same bug was fixed in `dotpi` at commit `3c7bbae`, then independently verified
  against upstream `v0.40.0`.
