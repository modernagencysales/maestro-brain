# Maestro Brain Repair-First Fabro Recovery Design

**Date:** 2026-07-22  
**Status:** Approved recovery direction; written checkpoint pending review

## Objective

Complete the 57-task Maestro Brain plan as quickly as possible without weakening
tenant safety, typed contracts, file ownership, focused task gates, immutable
integration evidence, or final repository verification.

Fabro owns the complete task lifecycle. A normal implementation, test, or review
failure is a loop condition, not a terminal workflow outcome.

## Operating Principles

1. Keep 12–20 dependency-safe Fabro coding lanes active while provider and host
   capacity remain healthy.
2. Give each task one durable owner worktree and a convergent coding loop.
3. Feed exact findings back to the owning implementation loop until resolved.
4. Run the three isolated review lenses concurrently.
5. Keep ownership locks and compute capacity as separate resources.
6. Continue unrelated implementation while integration or another owner repair
   is active.
7. Batch compatible green lanes to amortize code generation, semantic review,
   broad verification, and promotion.
8. Preserve serialized final promotion and authoritative repository gates.
9. Stop expanding the factory beyond the bounded changes required by this
   recovery design.

## Task-Lane Lifecycle

Every product task runs in one durable Fabro workflow:

```text
load immutable task contract and any prior findings
  -> write or update a failing regression test
  -> implement within manifest locks
  -> run focused lint, typecheck, and tests
  -> run contract, safety, and quality reviews concurrently
  -> aggregate every actionable finding
  -> repair all findings in the same owner worktree
  -> repeat gates and reviews
  -> emit lane proof and lane result only when genuinely green
```

Focused gate or review failures return to implementation. They do not terminate
the Fabro run. Each cycle records the candidate head and stable finding IDs so
the workflow can prove progress.

If an unchanged finding repeats, the workflow preserves the worktree and tries a
fresh repair context or stronger model. It stops only for a proven external
provider/resource failure or a contradictory contract that requires authority
outside the task.

## Finding-Bound Repair

Every repair input includes:

- stable finding ID and full finding text;
- owning task and immutable task-contract identity;
- prior integration or review candidate SHA;
- affected paths and ownership validation;
- expected behavioral correction;
- required regression proof;
- prior evidence hashes.

Implementation and all three reviewers must consume these fields. A reproof may
be green only when every prior finding is explicitly resolved. For a behavioral
defect, resolution requires an appropriate regression test and a relevant source
or test delta unless the finding itself proves that no change is needed.

## Review Concurrency

Contract, safety, and quality reviews use separate read-only review worktrees
and start concurrently. Aggregation waits for all three results. Any actionable
finding returns to the single owner implementation lane, which fixes the full
finding set before reviews run again.

Review work does not acquire product ownership and cannot certify changes it
authored itself.

## Capacity Model

The controller tracks separate resources:

- **coding capacity:** running implementation and repair agents;
- **review capacity:** isolated review workers;
- **ownership locks:** files reserved by running or green lanes;
- **integration capacity:** immutable candidate construction and review;
- **full-gate capacity:** host-test-slot protected repository verification;
- **promotion capacity:** one serialized control-head update.

A green lane retains ownership and evidence but consumes no coding slot. An
active or failed integration wave does not prevent dispatch of unrelated ready
tasks.

Initial limits are 12 coding lanes, 6 review workers, one integration candidate,
and one full-gate slot. Raise coding capacity to 20 after two stable integration
batches if provider errors are absent and host load remains within the existing
threshold.

## Integration Lifecycle

The integration controller selects the largest dependency-safe, lock-compatible
batch up to ten tasks, with a target minimum of five when the frontier permits.
Critical-path tasks may integrate earlier when doing so unlocks substantial
downstream work.

```text
select immutable green heads
  -> apply deterministically
  -> hydrate dependencies and generate owned output
  -> run semantic integration review
  -> route product findings directly to owner-lane repair
  -> repair generated/integration-only findings on the candidate
  -> run authoritative full verification
  -> record exact evidence
  -> promote serially
```

When semantic review identifies a hand-authored owner-lane defect, integration
terminates that candidate immediately with a finding-bound repair request. It
does not enter a repair node that is forbidden to edit the affected code.
Unrelated coding lanes continue throughout.

## Persistent Controller

Expose the existing controller core through the planned
`brain:factory:control --watch` command. Each tick reconciles durable Fabro
status, archives terminal records, routes findings, fills available coding
slots, creates integration batches, and promotes verified candidates.

The controller must be restart-safe and idempotent. It owns orchestration, not
product code. It must not require an interactive chat turn to advance from one
terminal state to the next.

## Immediate Recovery Order

1. Repair S04-T04 using the complete tenant-key versus durable organization-ID
   finding and require a tenant-isolation regression test.
2. Add and execute the already-planned integration-owned migration-registry
   transition required by S05-T01.
3. Integrate the repaired critical-path lanes with compatible existing green
   lanes.
4. Dispatch every newly unblocked task while preserving true dependencies and
   manifest locks.
5. Maintain 12–20 active coding/repair lanes until all task lanes are green.
6. Batch integration, reconcile acceptance, run final repository verification,
   promote, and produce the durable handoff.

## Bounded Factory Changes

Only the following factory changes are authorized by this recovery design:

- make coding, focused-gate, and review failures loop to implementation;
- bind immutable findings to implementation and all reviewers;
- run isolated review lenses concurrently;
- separate coding capacity from green-lane ownership;
- permit unrelated dispatch while integration is active;
- end impossible integration repairs directly in owner-lane repair requests;
- expose the existing persistent controller watch command;
- represent the missing S05 migration-registry transition;
- retain owner branches, worktrees, and evidence through promotion or audited
  supersession.

No unrelated factory redesign, production deployment, migration execution,
ingestion, purge, or MAE-394 work is part of this recovery slice.

## Verification and Completion

A task is complete only when its focused gates pass, all three independent
review lenses pass on the same exact head, prior findings are resolved, and its
lane proof is valid.

The Brain objective is complete only when all 57 task contracts have legitimate
terminal evidence, required integrations and acceptance reconciliation have
completed, authoritative repository verification passes through
`host-test-slot`, the final candidate is durably promoted through the authorized
path, and the handoff records exact SHAs, receipts, rollback evidence, and any
external actions still required.
