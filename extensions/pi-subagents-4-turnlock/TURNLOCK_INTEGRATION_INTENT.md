# Turnlock Integration Intent

> **Read this before modifying or reviewing the Turnlock-specific code or specs in this extension.**
>
> This document records the architectural intent behind `pi-subagents-4-turnlock`. It exists so that future agents do not have to reconstruct that intent from historical CDDs, implementation fragments, or old Turnlock revisions.
>
> The files under `specs/` are design work toward this intent. They are **not automatically authoritative about the current Turnlock API**. Before implementing them, compare them against the current Turnlock architecture.

---

## 1. Why this fork exists

Turnlock is intended to orchestrate agentic workflows **from inside an existing coding-agent session**.

A Turnlock workflow alternates between:

* deterministic code executed by Turnlock;
* explicit delegations to an LLM or agent;
* deterministic processing of the returned results;
* further explicit delegations when required.

Turnlock is intentionally **harness-agnostic**. It should describe *what kind of delegation is required* without embedding Pi-, Claude-, Codex-, or other harness-specific execution logic.

Pi is currently the primary harness.

`pi-subagents-4-turnlock` exists to provide the **Pi-specific worker execution backend** needed by Turnlock.

It is not intended to make Turnlock itself Pi-specific.

---

## 2. Core architectural idea: orchestration should be explicit

The central design goal is to move important agent orchestration out of implicit LLM behavior and into the explicit Turnlock workflow.

Without Turnlock, a main coding agent might decide during reasoning to:

1. spawn several subagents;
2. wait for them;
3. inspect their answers;
4. spawn additional agents;
5. synthesize their results.

That orchestration exists only as emergent behavior of the main agent.

The Turnlock model instead aims for:

```text id="un3xgd"
deterministic code
        ↓
explicit worker delegation
        ↓
collect results
        ↓
deterministic code
        ↓
explicit host delegation
        ↓
deterministic code
        ↓
explicit worker batch
        ↓
...
```

Agent invocation is therefore something the workflow can make visible, persist, resume, validate, and audit.

A main architectural objective is that **Turnlock, not the main LLM, owns the important orchestration topology**.

---

## 3. The three conceptual execution paths

Historically, the Turnlock design distinguished three different kinds of semantic execution.

### Host

`target=host` means:

> give the task to the main agent of the current coding-agent session.

In Pi:

```text id="7t71ug"
current Pi session
└── main agent
```

The main agent retains its existing conversation context and harness capabilities.

A host delegation is appropriate when the workflow deliberately wants the main agent's accumulated context or judgment.

The Turnlock/Pi worker integration described in this repository does **not** implement host execution.

Host continuation is a separate harness-level concern.

---

### Worker

`target=worker` means:

> execute the task in a separate worker agent rather than handing responsibility to the main agent.

In Pi, the intended implementation is a fresh Pi child session:

```text id="n9h4s6"
main Pi session
│
└── Turnlock workflow
     │
     └── worker delegation
          │
          └── independent Pi child session
               └── worker agent
```

For a batch:

```text id="l0stqj"
main Pi session
│
└── Turnlock workflow
     │
     └── worker batch
          ├── Pi child A
          ├── Pi child B
          ├── Pi child C
          └── Pi child D
```

The children may run concurrently.

They are independent **agent/session contexts**, although filesystem or workspace isolation is a separate concern and must not be assumed automatically.

`pi-subagents` already contains much of the Pi-specific machinery required to create and supervise these child sessions. This is why it was selected as the basis of the Turnlock worker backend.

---

### Direct model call

Some semantic work does not require a full coding-agent session.

A bounded task may instead be performed by a direct model/API call:

```text id="pklbvz"
Turnlock
   ↓
model API
   ↓
structured result
   ↓
Turnlock continues
```

This is conceptually distinct from both:

* `host`: use the existing main coding agent;
* `worker`: create a separate coding-agent/worker session.

---

## 4. What `pi-subagents-4-turnlock` is responsible for

This fork is specifically concerned with the **worker path for Pi**.

Its intended responsibility is approximately:

```text id="9u8qvi"
Turnlock worker request
        ↓
Pi strategy adapter
        ↓
pi-subagents Turnlock provider
        ↓
one or more Pi child sessions
        ↓
mechanical result collection
        ↓
Turnlock
```

Turnlock owns the workflow.

The Pi adapter maps Turnlock's harness-neutral worker request into Pi-specific execution.

`pi-subagents` owns the mechanics of creating and supervising the Pi child sessions.

The child workers produce results.

The integration mechanically returns those results to Turnlock.

The main agent does **not** need to sit between Turnlock and those workers.

---

## 5. Worker results do not require the main agent

A common source of confusion is assuming that the main agent must collect subagent answers.

It does not.

Example:

```text id="p5rncj"
Turnlock
   ↓
worker batch
   ├── Pi child A → result A
   ├── Pi child B → result B
   └── Pi child C → result C
   ↓
pi-subagents/Turnlock provider collects A/B/C
   ↓
Turnlock receives A/B/C
```

Turnlock may then explicitly decide to delegate again:

```text id="6vsexq"
A/B/C
  ↓
target=host
  ↓
main agent synthesizes them
```

or:

```text id="212z94"
A/B/C
  ↓
target=worker
  ↓
new Pi child synthesizes them
```

or:

```text id="ba3ldw"
A/B/C
  ↓
direct model call
  ↓
bounded synthesis
```

Collection and reasoning are separate operations.

---

## 6. Do not accidentally create two orchestrators

`pi-subagents` has capabilities such as chains, parallel execution, background jobs, etc.

Turnlock must remain the owner of workflow-level orchestration.

Therefore the Turnlock worker backend should preferably expose a **small execution primitive**, not the entire orchestration language of `pi-subagents`.

The historical design intentionally targeted something close to:

```text id="ju11dr"
one Turnlock worker set
        ↓
one static independent Pi worker group
        ↓
collect all results
```

For example:

```text id="jhskwe"
Turnlock:
worker A
→ deterministic phase
→ worker B
```

should not silently become:

```text id="6r4hs3"
Turnlock
→ pi-subagents internal chain A → B
```

The first representation keeps sequencing visible to Turnlock.

The second hides part of the workflow inside another orchestrator.

The intended ownership is:

```text id="qa9wm7"
Turnlock      = workflow orchestration
pi-subagents  = Pi worker execution
```

---

## 7. Main-agent access to the `subagent` tool is a separate policy decision

The upstream-style `pi-subagents` extension exposes a `subagent` tool directly to the main Pi agent.

That means the main agent can spontaneously create subagents.

This is **not required** for the Turnlock worker backend.

The underlying capabilities should be separated from their exposure:

```text id="k45knc"
pi-subagents
├── child-session execution engine
├── parallel worker execution
├── lifecycle/result machinery
├── Turnlock worker API
└── optional agent-facing `subagent` tool
```

A desirable future configuration may be:

```text id="28nxxq"
main agent can invoke `subagent` directly: NO
Turnlock worker provider can invoke subagents: YES
```

This would make Turnlock the only normal route through which the main session creates worker agents.

That policy would strengthen the explicit-orchestration model:

```text id="jlebxt"
main agent
   X  cannot spontaneously fan out

Turnlock workflow
   ↓
explicit worker delegation
   ↓
Pi child sessions
```

This is an architectural option, not an assumption that should be silently baked into lower-level execution code.

---

## 8. Why a "sessionless" execution engine was introduced

"Sessionless" does **not** mean that Turnlock is meant to run outside Pi.

The overall workflow still originates from and interacts with a coding-agent session.

The problem was an implementation dependency inside `pi-subagents`.

Historically, worker execution depended heavily on the live Pi extension context:

```text id="933lpu"
ExtensionAPI / ExtensionContext
        ↓
async execution
        ↓
Pi child
```

That is inconvenient for a durable Turnlock worker provider.

Once a worker launch has been completely resolved, its execution should ideally depend on a self-contained execution plan rather than the mutable interactive state of the parent session:

```text id="oibz9o"
ResolvedExecutionPlan
+ AgentConfigSnapshot
        ↓
sessionless execution engine
        ↓
Pi child
```

This allows the worker execution machinery to be invoked by the Turnlock provider without pretending to be the interactive main-agent tool path.

It also makes restart/recovery behavior much easier to reason about.

---

## 9. Why immutable execution plans and agent snapshots matter

A Turnlock delegation may be resumed after interruption.

The meaning of an already-accepted worker launch must not silently change because configuration changed later.

For example, if Turnlock resolved:

```text id="gd5n4t"
worker profile = reviewer
model = X
tools = [...]
prompt = P
```

and the controller later restarts, re-reading a modified `reviewer` configuration could change the semantics of the same logical launch.

The historical design therefore moved toward durable resolved execution plans and agent configuration snapshots.

The important principle is:

> once a worker launch has been accepted, recovery should execute the already-resolved launch rather than reinterpret mutable ambient configuration.

---

## 10. Why the durability machinery exists

The registry, launcher identity, claim/fence protocol, result envelopes, reconciliation, retention, and related CDDs are not arbitrary infrastructure.

They were introduced because ordinary `pi-subagents` lifecycle behavior was insufficient for Turnlock's restart guarantees.

### Idempotent launch identity

Turnlock must be able to say:

```text id="l1p2oo"
launch worker set K
```

and safely retry the request after uncertainty.

The desired semantics are approximately:

```text id="auxd8u"
same K + same request
→ same logical launch / already accepted

same K + different request
→ conflict

never:
same K + retry
→ silently create duplicate workers
```

---

### Claim and fencing

A crash can occur after a launcher process has been spawned but before the parent has durably observed that fact.

A replacement launcher must not cause two generations to execute the same logical worker launch.

Hence the historical move toward:

```text id="igjows"
generation
nonce
atomic child claim
fenceGeneration
```

An obsolete launcher that later resumes must be prevented from continuing to produce effects.

---

### Process-group supervision

Stopping only a parent PID may leave descendant processes alive.

A worker may spawn shells, Node processes, or other children.

The launcher/process-group design exists so that "stop this worker launch" can mean stopping the actual process tree, not merely one supervising PID.

---

### Result persistence

A worker's result must not disappear merely because one controller read it.

Turnlock can crash after a worker completes but before the result has been durably incorporated into workflow state.

Therefore the desired lifecycle is closer to:

```text id="sc61w2"
worker completes
→ durable result
→ Turnlock reads result
→ Turnlock durably records consumption
→ explicit retention acknowledgement
→ safe cleanup
```

not:

```text id="vca880"
read result
→ immediately delete it
```

---

### Reconciliation

After a crash, registry state, process state, and result artifacts may temporarily disagree.

The provider must reconstruct what can be proven rather than guess.

Ambiguity should remain explicit.

---

## 11. Architectural boundaries

When changing this extension, preserve these boundaries unless there is an explicit architectural decision to change them:

```text id="llisy9"
Turnlock
    owns:
    - workflow topology
    - sequencing
    - explicit delegation decisions
    - deterministic phases
    - resume semantics at workflow level

Pi harness integration
    owns:
    - mapping harness-neutral delegations to Pi mechanisms
    - host continuation integration
    - worker-provider selection

pi-subagents Turnlock provider
    owns:
    - execution of Pi worker child sessions
    - worker lifecycle
    - worker result collection
    - worker launch/recovery guarantees

main Pi agent
    is:
    - the target of explicit host delegations
    - NOT inherently the worker orchestrator

Pi child
    is:
    - an isolated agent/session context used to execute a worker job
```

---

## 12. Non-goals

Do not infer from these specs that this project intends to:

* make Turnlock Pi-specific;
* move workflow orchestration into `pi-subagents`;
* make `pi-subagents` responsible for host/main-agent execution;
* require the main agent to proxy worker launches or collect worker results;
* expose every `pi-subagents` orchestration feature through Turnlock;
* assume Pi child sessions imply filesystem isolation;
* assume historical Turnlock APIs are still current.

---

## 13. Historical status of the specs

The files under `specs/` were written during an earlier Turnlock design iteration.

They represent attempts to solve real requirements, especially around:

* sessionless execution;
* immutable resolved plans;
* idempotent launches;
* crash-safe launcher ownership;
* fencing;
* process supervision;
* result persistence;
* recovery;
* retention.

However:

> **Do not implement the historical specs mechanically.**

Before implementation:

1. inspect the current Turnlock delegation protocol;
2. identify which historical requirements still exist;
3. identify which are now solved elsewhere;
4. preserve the architectural intent described in this document;
5. update or replace stale CDDs as necessary.

---

## 14. The shortest possible mental model

If only one thing from this document is remembered, remember this:

```text id="g3ik0y"
Turnlock is the orchestrator.

The main Pi agent is one possible explicit execution target.

Pi child agents are another explicit execution target.

Direct LLM calls are another possible execution target.

pi-subagents-4-turnlock exists to implement the Pi-child/worker path,
not to become another workflow orchestrator.
```

And the long-term direction may be even stricter:

```text id="8752i3"
important fan-out should be explicit in Turnlock,
not an invisible decision made by the main agent during inference.
```
