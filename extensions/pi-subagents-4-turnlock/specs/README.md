# Specs (historical design artifacts)

> **These specs are historical design artifacts, not authoritative about the current Turnlock API.**
>
> The architectural intent for this extension lives in [`../TURNLOCK_INTEGRATION_INTENT.md`](../TURNLOCK_INTEGRATION_INTENT.md). **Read it first.**

Do **not** implement these specs mechanically. Before implementing anything here, compare each document against the current Turnlock delegation protocol and verify which requirements are still current.

## Layout

| Path | What it contains |
|------|------------------|
| [`legacy/`](./legacy/) | Early proto-CDD exploration |
| [`standards/`](./standards/) | Historical standards (liveness, runner coordination) |
| [`working/`](./working/) | Historical CDDs (sessionless engine, registry, launcher, claim/fence, reconciler, result collector, orchestrator) |

See "Historical status of the specs" in [`../TURNLOCK_INTEGRATION_INTENT.md`](../TURNLOCK_INTEGRATION_INTENT.md) for the full list of concerns these documents attempted to solve, and the procedure for updating or replacing stale CDDs.
