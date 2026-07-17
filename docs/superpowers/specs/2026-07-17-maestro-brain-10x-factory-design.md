# Maestro Brain 10× Factory Design

**Date:** 2026-07-17  
**Status:** approved for implementation planning  
**Scope:** Maestro Brain task dispatch, review, gates, integration, and recovery

## Objective

Increase verified Maestro Brain delivery throughput by at least 10× without
weakening tenant isolation, typed contracts, independent review, focused lane
proof, or the broad pre-promotion gate.

The target is throughput, not merely faster individual agents. The factory must
combine:

- at least 3× lower wall time for defect-heavy lanes;
- at least 4× more useful work in flight after dependency-frontier surgery;
- at least 80% utilization whenever dependency-safe work exists.

The current baseline is approximately 50 minutes for a defect-heavy task,
because a reviewer reports one defect, the task repeats implementation and a
complete gate, and another reviewer reports the next defect. A clean one-pass
lane completes in approximately 12 minutes. The current manifest exposes only
three or four conflict-free product lanes, even though Fabro supports 100
concurrent runs and the provider pool can sustain substantially more inference
work.

## Invariants

- Fabro remains the only product-code implementer. The operator may change
  factory workflows, contracts, deterministic checks, and evidence machinery.
- A task is not integrated without exact-head proof, independent review, and the
  task's focused gate.
- A promoted integration batch is not accepted without one broad gate on its
  exact head.
- Review findings cannot be discarded, downgraded, or hidden to increase
  throughput.
- Broad tests run through `host-test-slot`; focused tests use the same host
  semaphore.
- Generated Confect and Convex files remain integration-owned and are never
  hand-edited.
- Provider, optional MCP, and qlty availability failures remain explicit
  environmental evidence rather than assumed success.
- The factory must remain restart-safe and idempotent. Conversation memory is
  never authoritative state.

## Architecture

The accelerated factory has six cooperating control-plane components.

### 1. Persistent Frontier Controller

A persistent controller owns scheduling instead of relying on a chat turn to
notice terminal runs. It continuously reconciles the task manifest, task
reservations, Fabro status, lane evidence, integration evidence, and the control
branch.

On every tick it:

1. archives terminal reservations;
2. launches audited recovery for lanes with actionable findings;
3. queues green lanes for the next integration batch;
4. promotes successful integration batches;
5. recomputes the dependency and file-lock frontier;
6. launches every safe task up to the configured lane cap;
7. records every decision in durable audit evidence.

The controller must be idempotent. Repeating a tick against unchanged state must
produce no new run, reservation, branch, worktree, or evidence mutation.

### 2. Contract Frontier Optimizer

Every task relationship is classified as one of:

- **true dependency:** implementation requires an integrated runtime, schema, or
  data contract from the predecessor;
- **contract dependency:** implementation can start against a frozen typed
  interface before the predecessor's body is integrated;
- **integration collision:** tasks may implement independently, but both touch a
  registry or generated output that must be reconciled centrally.

Only true dependencies remain in `codeStartAfter`. Contract dependencies use an
exact, hashed contract artifact. Integration collisions do not block dispatch;
they are declared to the integration planner.

Shared additive registries, beginning with
`packages/convex/confect/internal/migrations.ts`, become generated or
integration-owned. Task lanes produce per-task registration fragments. The
integrator deterministically assembles, sorts, validates, and generates the
canonical registry. This removes the current mutual exclusion among `S02-T03`,
`S05-T01`, and `S10-T01`.

Before widening the frontier, the optimizer must prove that every removed edge
is not a true dependency and that every relaxed collision has a deterministic
merge rule.

### 3. Parallel Exhaustive Review

One general reviewer is replaced by three independent, read-only lenses running
in parallel:

- **contract lens:** task packet, typed API, schema, plan, ownership, and
  failure-contract compliance;
- **safety lens:** tenancy, authorization, lifecycle, privacy, concurrency,
  replay, fencing, and provider boundaries;
- **quality lens:** test adequacy, layer law, maintainability, observability,
  budgets, and generated-file discipline.

Each lens writes a separate immutable artifact containing:

- exact task, plan, contract, base, head, and tree identities;
- every required rubric item and its `pass`, `finding`, or `not_applicable`
  disposition;
- all findings discovered in that pass;
- evidence paths and source locations;
- a terminal lens verdict.

A deterministic aggregator verifies exact-head identity, complete rubric
coverage, unique stable finding IDs, and lens independence. It unions all
findings before repair begins. A reviewer cannot stop after the first blocker;
missing rubric dispositions make the lens artifact invalid.

One repair worker receives the complete aggregate. After repair, affected checks
run and all three lenses re-review the new exact head in parallel. A task may
require another aggregate cycle if new findings appear, but every cycle must
show monotonic progress: resolved finding IDs stay resolved unless their proof
is invalidated, and new IDs must identify genuinely new evidence.

### 4. Gate Scheduler

Inference concurrency and host-test concurrency are managed separately.

- Start with 20–24 active Fabro implementation/review runs when the frontier
  permits it.
- Reserve 12–16 slots for implementation and 4–6 for review or repair.
- Keep focused host gates at two concurrent slots initially.
- Allow a controlled experiment with three focused slots only when one-minute
  load remains below 20 and memory pressure stays healthy.
- Permit exactly one broad gate. A broad gate is exclusive and must not overlap
  focused gates.

Implementation uses failure-first tests and affected lint/type checks. Repair
uses the tests covering the aggregate findings. The complete task-focused gate
runs once after the aggregate review is clean. This preserves the final proof
while removing repeated full lane gates between individual findings.

### 5. Deterministic Batch Integrator

Mechanical integration work is implemented as deterministic tooling:

- selection and digest validation;
- dependency and file-ownership validation;
- commit application and conflict classification;
- integration-owned registry assembly;
- Confect, Convex, manifest, and route generation;
- formatting and exact generated-output proof;
- evidence creation and hashing.

An LLM is used only for semantic cross-lane review or a conflict that cannot be
resolved by a declared deterministic rule.

The target batch contains 5–10 disjoint green tasks. Smaller batches are
permitted only when the frontier is exhausted or a true dependency makes early
promotion valuable. Each batch runs one affected integration check and one broad
exact-head gate before promotion.

The immutable selection uses one canonical serialization and one canonical
digest. Raw-file and semantic digests cannot be confused. Preflight validates
the selection before any LLM node or integration mutation begins.

### 6. Durable Recovery and Telemetry

Cycle limits operate on stable finding IDs and workflow state, not normalized
generic failure strings. A `rework` verdict routes directly to repair.
Completion and final-gate nodes are reachable only after the aggregate verdict
is `pass`.

Terminal failures with an actionable aggregate automatically create a fresh,
audited repair run from the preserved clean head. Environmental failures use
bounded retry with backoff and do not consume product repair attempts.

The factory records:

- ready-to-launch latency;
- active implementation, review, focused-gate, and broad-gate counts;
- time per workflow stage;
- findings per review lens and aggregate cycle;
- repeated versus new findings;
- gate queue time and execution time;
- integrated tasks per rolling hour;
- provider throttling and host load.

## Workflow State Model

```text
reserved
  -> implementing
  -> affected_checks
  -> parallel_review
  -> aggregate
       -> repair -> affected_checks -> parallel_review
       -> final_focused_gate
  -> lane_green
  -> batch_selected
  -> deterministic_integration
  -> semantic_wave_review
  -> broad_gate
  -> promoted
```

No `rework` path passes through `lane_green`, completion, or final-gate
evidence. No lane result may claim `lane_green` before the final focused gate
passes.

## Rollout

### Phase 0: Restore Forward Motion

- Integrate the already-green `S03-T03` lane.
- Recover `S04-T02` from its preserved head and aggregated cursor-generation
  finding.
- Recover integration wave 18 for `S11-T02` after separating inherited broad
  debt from selected-wave regressions and validating one canonical selection
  digest.

### Phase 1: Eliminate Serial Review Churn

- Add the three lens workflows and deterministic aggregate schema/checker.
- Route aggregate rework directly to repair.
- Prevent pre-final lane results from claiming `lane_green`.
- Run the complete focused gate only after aggregate pass.

### Phase 2: Determinize Integration

- Move mechanical integration operations out of LLM nodes.
- Canonicalize selection serialization and hashing.
- Batch green lanes and run one exact-head broad gate per promotion batch.

### Phase 3: Widen the Frontier

- Audit every remaining `codeStartAfter` edge.
- Freeze contract artifacts for contract dependencies.
- Promote shared additive registries to deterministic integration ownership.
- Recompute the remaining-wave schedule and prove file-lock safety.

### Phase 4: Ramp Concurrency

- Start at 12 active runs while validating the new workflows.
- Raise to 20 after two clean batches.
- Raise toward 24–32 only when provider latency, host load, memory pressure, and
  gate queue time remain within thresholds.
- Never launch duplicate ownership for a task, finding, or exact head.

## Success Criteria

The redesign is successful when all of the following hold over a rolling
four-hour build window with at least ten completed tasks:

- integrated-task throughput is at least 10× the measured pre-redesign rate;
- median clean-lane wall time is at most 15 minutes;
- median defect-heavy lane wall time is at most 22 minutes;
- at least 90% of tasks finish in no more than two aggregate review cycles;
- median ready-to-launch latency is at most 60 seconds;
- utilization is at least 80% whenever dependency-safe work exists;
- integration batches contain at least five tasks unless the frontier contains
  fewer than five;
- no task is promoted without exact-head lane proof and aggregate review pass;
- no batch is promoted without a passing broad exact-head gate;
- escaped blocker/high findings do not increase relative to the current
  independent-review baseline;
- replaying the controller against unchanged state launches nothing and changes
  no evidence.

If throughput is below 5× after Phase 3, the controller must report whether the
remaining limit is true dependencies, provider capacity, host gates, or repair
quality. It must not silently increase concurrency.

## Rollback Conditions

Return to the prior dispatcher and two-slot focused gate configuration if any of
the following occurs:

- duplicate task ownership;
- evidence identity drift;
- an integration-owned registry cannot be reproduced deterministically;
- host load remains above 20 or memory pressure causes worker termination;
- provider throttling persists after reducing the active pool;
- aggregate review misses a blocker/high issue that the prior review workflow
  detects on the same head.

Rollback preserves all lane branches, evidence, reservations, and audit logs. It
never resets or discards product work.
