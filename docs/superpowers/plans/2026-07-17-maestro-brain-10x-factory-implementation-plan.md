# Maestro Brain 10× Factory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace serial one-finding review loops and turn-bound scheduling with
an exhaustive parallel-review, deterministic-integration, persistent Maestro
Brain factory that delivers at least 10× verified throughput.

**Architecture:** Extend the existing `tooling/brain-factory` state and evidence
contracts. Three independent Fabro review nodes write exact-head lens artifacts;
a deterministic aggregator owns the proof verdict. A pure controller planner
reconciles durable state and invokes existing audited dispatch, recovery,
integration, and promotion commands. Mechanical wave integration moves into
deterministic TypeScript, while a semantic LLM reviewer remains after the exact
wave head exists.

**Tech Stack:** TypeScript, Vitest, Fabro DOT workflows, Git worktrees, pnpm,
`host-test-slot`, Confect/Convex code generation.

## Global Constraints

- Follow [AGENTS.md](../../../AGENTS.md) and the approved
  [10× factory design](../specs/2026-07-17-maestro-brain-10x-factory-design.md).
- Fabro remains the only product-code implementer; control-plane tooling and
  evidence contracts may be changed in this branch.
- Do not hand-edit generated Confect or Convex files.
- Every shell command begins with `rtk`; broad local gates use
  `host-test-slot --class full`.
- A task becomes `lane_green` only after aggregate review pass and the final
  focused gate on the same exact head.
- A promoted wave requires one broad exact-head gate.
- Preserve `.mcp.json` and all unrelated work.

---

### Task 1: Exact-Head Parallel Review Contract

**Work package:** `template-gap`

- Missing pattern: independent multi-lens review with deterministic aggregation.
- Backlog reference: 10× design, “Parallel Exhaustive Review.”
- Promotion path: prove the contract in `tooling/brain-factory`, then reuse it
  from every code-producing factory workflow.

**Files:**

- Create: `tooling/brain-factory/src/review-lens.ts`
- Create: `tooling/brain-factory/src/review-aggregate.mts`
- Create: `tooling/brain-factory/test/review-lens.test.mts`
- Modify: `tooling/brain-factory/src/proof.ts`
- Modify: `tooling/brain-factory/package.json`

**Interfaces:**

- Produces: `validateReviewLens(value, expected): ReviewLensArtifact` and
  `aggregateReviewLenses(input): ReviewAggregate`.
- Lens names are exactly `contract | safety | quality`.
- Each lens artifact binds `taskId`, `planSha256`, `taskBlockHash`, `baseSha`,
  `headSha`, `treeSha`, `reviewerRunId`, complete rubric dispositions, findings,
  and `verdict`.
- The aggregate contains stable sorted findings and is the only function allowed
  to set the proof’s `reviewVerdict` and `reviewFindings`.

- [ ] **Step 1: Add failing contract tests**

  Cover exact-head mismatch, missing lens, duplicate reviewer run, missing
  rubric disposition, duplicate finding ID, stable sorting, three-pass
  aggregation, and rework aggregation.

  ```ts
  expect(() =>
    aggregateReviewLenses({
      expected,
      lenses: [contractLens, safetyLens],
    }),
  ).toThrow("missing review lens quality");

  expect(
    aggregateReviewLenses({
      expected,
      lenses: [contractLens, safetyLens, qualityLens],
    }).reviewVerdict,
  ).toBe("pass");
  ```

- [ ] **Step 2: Run the focused test and verify RED**

  Run:

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test review-lens
  ```

  Expected: failure because `review-lens.ts` does not exist.

- [ ] **Step 3: Implement the pure validator and aggregator**

  Use discriminated, JSON-safe records. Require all configured rubric IDs and
  all three lenses. Generate the aggregate verdict with:

  ```ts
  const reviewVerdict = findings.length === 0 ? "pass" : "rework";
  ```

  Reject a lens whose head, tree, plan, contract, task, or reviewer identity is
  inconsistent. Never infer `not_applicable`; the lens must declare it.

- [ ] **Step 4: Add the aggregate CLI**

  `review-aggregate.mts` accepts `--task`, `--workdir`, and `--evidence`, reads
  the three artifacts under `lane-results/<task>/review-lenses/<head>/`,
  validates them, and atomically updates only the review fields in
  `ci-proof-packet.json`.

- [ ] **Step 5: Run focused verification**

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test review-lens proof
  rtk pnpm --dir tooling/brain-factory typecheck
  ```

  Expected: all selected tests and typecheck pass.

- [ ] **Step 6: Commit**

  ```bash
  rtk git add tooling/brain-factory/src/review-lens.ts tooling/brain-factory/src/review-aggregate.mts tooling/brain-factory/src/proof.ts tooling/brain-factory/test/review-lens.test.mts tooling/brain-factory/package.json
  rtk git commit -m "feat: aggregate exhaustive lane reviews"
  ```

### Task 2: Parallel Review Workflow and Correct Finalization

**Work package:** `template-gap`

- Missing pattern: parallel Fabro review fan-out with deterministic join and
  pass-only finalization.
- Backlog reference: 10× design, “Workflow State Model.”
- Promotion path: make `brain-build-task` the canonical reviewed lane workflow.

**Files:**

- Modify: `.fabro/workflows/brain-build-task/workflow.fabro`
- Modify: `tooling/brain-factory/src/write-lane-result.mts`
- Modify: `tooling/brain-factory/src/lane-result.ts`
- Modify: `tooling/brain-factory/test/lane-result.test.mts`
- Modify: `tooling/brain-factory/test/workflow-prompt-contract.test.mts`

**Interfaces:**

- Consumes the Task 1 lens schema and aggregate CLI.
- Produces workflow nodes `review_contract`, `review_safety`, `review_quality`,
  `review_aggregate`, and `aggregate_gate`.
- `write-lane-result.mts` additionally requires an exact-head final gate receipt
  with `stage: "final"` and `status: "passed"`.

- [ ] **Step 1: Add failing workflow-shape tests**

  Assert that all three review nodes are reachable from the same captured
  snapshot, each writes only its named lens artifact, the aggregate waits for
  all lens artifacts, and rework routes directly to `implement`.

  Assert this pass-only order:

  ```text
  review_aggregate -> aggregate_gate -> final_gates -> complete -> exit
  ```

  Assert `complete -> final_gates` no longer exists.

- [ ] **Step 2: Add failing lane-result tests**

  ```ts
  expect(() => validateFinalLaneResult(lane, expectedWithoutFinalGate)).toThrow(
    "final lane gate",
  );
  ```

  Also reject `lane_green` when the proof is pending/rework or review head is
  not the current head.

- [ ] **Step 3: Run RED tests**

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test workflow-prompt-contract lane-result
  ```

- [ ] **Step 4: Replace the single reviewer with three exhaustive lenses**

  Give each prompt the exact rubric for its lens and require a disposition for
  every rubric item. Each node may write only:

  ```text
  <evidence>/lane-results/<task>/review-lenses/<head>/<lens>.json
  ```

  The reviewers never edit the proof packet or product worktree.

- [ ] **Step 5: Add the deterministic join and direct rework route**

  The aggregate node invokes `review-aggregate.mts`. The aggregate gate succeeds
  only for `reviewVerdict: pass`; its `retry_target` is `implement`. Remove the
  path that writes a lane result before final gates.

- [ ] **Step 6: Harden final lane-result creation**

  Read and validate the proof, review aggregate, exact worktree head, exact
  tree, and final gate receipt before atomically writing `lane-result.json`.

- [ ] **Step 7: Validate and test**

  ```bash
  rtk fabro validate .fabro/workflows/brain-build-task/workflow.fabro
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test workflow-prompt-contract lane-result review-lens
  rtk pnpm --dir tooling/brain-factory typecheck
  ```

- [ ] **Step 8: Commit**

  ```bash
  rtk git add .fabro/workflows/brain-build-task/workflow.fabro tooling/brain-factory/src/write-lane-result.mts tooling/brain-factory/src/lane-result.ts tooling/brain-factory/test/lane-result.test.mts tooling/brain-factory/test/workflow-prompt-contract.test.mts
  rtk git commit -m "fix: finalize lanes only after review pass"
  ```

### Task 3: Canonical Selection Identity and Deterministic Wave Application

**Work package:** `template-gap`

- Missing pattern: deterministic selected-lane application and unambiguous
  selection identity.
- Backlog reference: 10× design, “Deterministic Batch Integrator.”
- Promotion path: replace the integration workflow’s `integrate` LLM node with a
  deterministic command while retaining semantic review.

**Files:**

- Create: `tooling/brain-factory/src/apply-integration-wave.ts`
- Create: `tooling/brain-factory/src/apply-integration-wave.mts`
- Create: `tooling/brain-factory/test/apply-integration-wave.test.mts`
- Modify: `tooling/brain-factory/src/integration-wave.ts`
- Modify: `tooling/brain-factory/src/integration-wave-selection-check.mts`
- Modify: `tooling/brain-factory/src/integrate-wave.mts`
- Modify: `.fabro/workflows/brain-integrate-wave/workflow.fabro`
- Modify: `tooling/brain-factory/test/integration-wave.test.mts`
- Modify: `tooling/brain-factory/test/workflow-prompt-contract.test.mts`

**Interfaces:**

- `canonicalSelectionPayload(value): string` produces the only hashed selection
  serialization.
- Evidence fields are explicitly named `selectionPayloadSha256` and
  `selectionFileSha256`; they are never compared to each other.
- `applyIntegrationWave(input)` returns the exact head, included task receipts,
  generated files, focused checks, and conflicts.

- [ ] **Step 1: Add RED tests for identity semantics**

  Prove that formatting the selection file changes only `selectionFileSha256`,
  while the canonical payload digest remains stable. Prove mutation of any
  selected task receipt changes the payload digest.

- [ ] **Step 2: Add RED integration-application tests**

  Use temporary repositories to prove deterministic task ordering, complete
  base-to-head application, missing-patch recovery, duplicate-patch rejection,
  conflict failure, integration-owned generated-file allowlisting, and clean
  output.

- [ ] **Step 3: Run RED tests**

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test integration-wave apply-integration-wave
  ```

- [ ] **Step 4: Implement canonical identity helpers**

  Make `selectionPayload` public, serialize sorted object keys with stable array
  order, and calculate payload/file hashes at the write boundary. Reject legacy
  ambiguous fields when producing a new wave.

- [ ] **Step 5: Implement deterministic wave application**

  Reuse `hydrateWorktreeDependencies`, `validateIntegrationWaveSelection`, lane
  ownership checks, and generated-output proof. Shell out only through `runRtk`.
  Do not invoke an LLM for cherry-picking, codegen, formatting, or evidence.

- [ ] **Step 6: Replace the integration LLM node**

  The workflow invokes `apply-integration-wave.mts`, then dependency hydration,
  semantic wave review, broad gate, record, and post-record. Preflight validates
  both selection hashes before any mutation.

- [ ] **Step 7: Run focused verification**

  ```bash
  rtk fabro validate .fabro/workflows/brain-integrate-wave/workflow.fabro
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test integration-wave apply-integration-wave integration-result-check workflow-prompt-contract
  rtk pnpm --dir tooling/brain-factory typecheck
  ```

- [ ] **Step 8: Commit**

  ```bash
  rtk git add tooling/brain-factory/src/apply-integration-wave.ts tooling/brain-factory/src/apply-integration-wave.mts tooling/brain-factory/src/integration-wave.ts tooling/brain-factory/src/integration-wave-selection-check.mts tooling/brain-factory/src/integrate-wave.mts tooling/brain-factory/test/apply-integration-wave.test.mts tooling/brain-factory/test/integration-wave.test.mts .fabro/workflows/brain-integrate-wave/workflow.fabro tooling/brain-factory/test/workflow-prompt-contract.test.mts
  rtk git commit -m "feat: determinize brain wave integration"
  ```

### Task 4: Persistent Idempotent Frontier Controller

**Work package:** `template-gap`

- Missing pattern: restart-safe continuous factory reconciliation.
- Backlog reference: 10× design, “Persistent Frontier Controller.”
- Promotion path: expose a checked-in `brain:factory:control` command for local
  and CI babysitters.

**Files:**

- Create: `tooling/brain-factory/src/controller.ts`
- Create: `tooling/brain-factory/src/controller.mts`
- Create: `tooling/brain-factory/test/controller.test.mts`
- Modify: `tooling/brain-factory/src/dispatch-ownership.ts`
- Modify: `tooling/brain-factory/src/factory-state.ts`
- Modify: `package.json`

**Interfaces:**

- `planControllerTick(snapshot, policy): readonly ControllerAction[]` is pure.
- Actions are `archive_terminal`, `recover_lane`, `promote_wave`,
  `recover_wave`, `integrate_batch`, `dispatch_tasks`, or `wait`.
- CLI modes are `--once` and `--watch --interval-ms <n>`.

- [ ] **Step 1: Add RED planner tests**

  Cover unchanged replay, terminal reservation archival, actionable lane repair,
  stale false-green rejection, successful-wave promotion, failed-wave recovery,
  batching green lanes, safe frontier dispatch, and duplicate ownership.

- [ ] **Step 2: Run RED tests**

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test controller dispatch-ownership factory-state
  ```

- [ ] **Step 3: Implement the pure planner**

  Give every action a deterministic identity derived from control head, task or
  wave identity, source run, and finding digest. Identical snapshots must
  produce identical plans.

- [ ] **Step 4: Implement audited action execution**

  Reuse existing dispatch locks, task reservations, recovery audit, integration
  reservation, and promotion commands. Write a tick receipt before executing an
  action and its result afterward. Never infer success from a missing Fabro
  context.

- [ ] **Step 5: Add watch mode and telemetry**

  Emit ready-to-launch latency, active counts by stage, gate queue state,
  provider errors, and controller action duration as JSONL under factory state.

- [ ] **Step 6: Verify dry-run idempotency**

  ```bash
  rtk pnpm brain:factory:control -- --once --dry-run --state .fabro/state/maestro-brain
  rtk pnpm brain:factory:control -- --once --dry-run --state .fabro/state/maestro-brain
  ```

  Expected: byte-identical planned actions and no state mutation.

- [ ] **Step 7: Run focused verification and commit**

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test controller dispatch-ownership factory-state scheduler
  rtk pnpm --dir tooling/brain-factory typecheck
  rtk git add tooling/brain-factory/src/controller.ts tooling/brain-factory/src/controller.mts tooling/brain-factory/src/dispatch-ownership.ts tooling/brain-factory/src/factory-state.ts tooling/brain-factory/test/controller.test.mts package.json
  rtk git commit -m "feat: add persistent brain factory controller"
  ```

### Task 5: Dependency and Collision Contract

**Work package:** `template-gap`

- Missing pattern: distinguish true code dependencies, contract dependencies,
  and integration-only collisions.
- Backlog reference: 10× design, “Contract Frontier Optimizer.”
- Promotion path: add a deterministic parallelism contract beside the generated
  task manifest, then teach scheduler and wave integration to enforce it.

**Files:**

- Create: `docs/superpowers/execution/maestro-brain/parallelism-contract.json`
- Create: `tooling/brain-factory/src/parallelism-contract.ts`
- Create: `tooling/brain-factory/test/parallelism-contract.test.mts`
- Modify: `tooling/brain-factory/src/manifest.ts`
- Modify: `tooling/brain-factory/src/scheduler.ts`
- Modify: `tooling/brain-factory/src/integration-wave.ts`
- Modify: `tooling/brain-factory/test/manifest.test.mts`
- Modify: `tooling/brain-factory/test/scheduler.test.mts`

**Interfaces:**

- Every remaining dependency edge is classified `true` or `contract`.
- Every relaxed shared path declares an integration collision policy.
- Contract dependencies bind a SHA-256 contract artifact.
- No manifest edge is removed without an exact classification entry.

- [ ] **Step 1: Add RED schema and coverage tests**

  Require exact coverage of all remaining `codeStartAfter` edges and every
  pairwise file-lock collision. Reject unknown tasks, missing hashes, duplicate
  classifications, cycles, and a relaxed collision with no merge policy.

- [ ] **Step 2: Run RED tests**

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test parallelism-contract manifest scheduler integration-wave
  ```

- [ ] **Step 3: Audit and write the contract**

  For each remaining edge, inspect the task packets and exact produced/consumed
  interfaces. Keep real schema/runtime dependencies. Relax only merge-order
  relationships backed by frozen contracts. Classify shared
  `packages/convex/confect/internal/migrations.ts` work as an integration
  collision only after Task 6 provides deterministic registry assembly.

- [ ] **Step 4: Teach the scheduler the new semantics**

  True dependencies block code start. Contract dependencies require the exact
  contract hash but not predecessor integration. Integration collisions may be
  co-dispatched and become mandatory wave-integration inputs.

- [ ] **Step 5: Recompute and assert frontier width**

  Add a fixture for the current 19-task integrated state and require the
  post-frontier safe width promised by the audited contract. The test must print
  the limiting true dependencies when width remains below ten.

- [ ] **Step 6: Verify and commit**

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test parallelism-contract manifest scheduler integration-wave
  rtk pnpm brain:factory:check
  rtk pnpm --dir tooling/brain-factory typecheck
  rtk git add docs/superpowers/execution/maestro-brain/parallelism-contract.json tooling/brain-factory/src/parallelism-contract.ts tooling/brain-factory/src/manifest.ts tooling/brain-factory/src/scheduler.ts tooling/brain-factory/src/integration-wave.ts tooling/brain-factory/test/parallelism-contract.test.mts tooling/brain-factory/test/manifest.test.mts tooling/brain-factory/test/scheduler.test.mts
  rtk git commit -m "feat: widen the brain task frontier"
  ```

### Task 6: Integration-Owned Migration Registry

**Work package:** `template-gap`

- Missing pattern: per-task migration fragments with deterministic canonical
  registry generation.
- Backlog reference: 10× design, “Contract Frontier Optimizer.”
- Promotion path: create a reusable template pattern after the Maestro Brain
  factory proves deterministic generation.

**Files:**

- Product targets are determined by the approved S02/S05/S10 migration packets.
- Modify: `packages/convex/confect/internal/migrations.ts`
- Modify: `tooling/brain-factory/src/integration-generated-proof.ts`
- Modify: `tooling/brain-factory/src/lane-ownership.ts`
- Modify: `tooling/brain-factory/test/integration-generated-proof.test.mts`
- Modify: `tooling/brain-factory/test/lane-ownership.test.mts`
- Create through Fabro: per-task migration registration fragments and focused
  tests under the packet-owned Convex paths.

**Interfaces:**

- Product-code changes are implemented only by a dedicated Fabro lane.
- Task lanes own registration fragments, never the canonical registry.
- Integration deterministically sorts fragments and rejects duplicate migration
  IDs or incompatible ordering constraints.

- [ ] **Step 1: Generate a dedicated Fabro task contract**

  The contract names the existing migration fixture/registry, fragment schema,
  deterministic generator target, owning files, source-line budget, and focused
  Convex migration gates. It must pass `brain:factory:check` before launch.

- [ ] **Step 2: Launch the Fabro lane test-first**

  The first test proves two independent fragments assemble in stable order and
  duplicate IDs fail. Fabro owns all product and product-test edits.

- [ ] **Step 3: Extend integration ownership after the lane is green**

  Permit the canonical registry only as integration-generated output and prove
  exact-head regeneration is byte-identical.

- [ ] **Step 4: Run focused verification**

  ```bash
  rtk host-test-slot --class focused pnpm --dir packages/convex test migrations
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test integration-generated-proof lane-ownership
  rtk pnpm brain:factory:check-confect-codegen
  ```

- [ ] **Step 5: Integrate and commit the control contract**

  Product commits arrive only through the successful Fabro lane and integration
  workflow. Commit control ownership changes separately with subject:

  ```text
  feat: generate the migration registry at integration
  ```

### Task 7: Restore Frontier, Canary, and Continuous Rollout

**Work package:** `template-gap`

- Missing pattern: audited adoption of a new factory control plane while lanes
  already exist.
- Backlog reference: 10× design, “Rollout.”
- Promotion path: canary the new workflows on preserved current heads, then run
  the persistent controller until all remaining tasks integrate.

**Files:**

- Modify: `.fabro/workflows/brain-build-task/workflow.fabro`
- Modify: `.fabro/workflows/brain-integrate-wave/workflow.fabro`
- Evidence only: `.fabro/state/maestro-brain/**`
- Update: `docs/superpowers/receipts/maestro-brain/10x-factory-rollout.md`

**Interfaces:**

- S03-T03 green head: `195db6c28eb821d3052be2cbc085f8aeed8043f8`.
- S04-T02 preserved repair head: `67ba401d3f92275ab2758a5871d2c3518316bc6f` with
  finding `S04-T02-RW-004`.
- Wave 18 integration head: `533ad78e2533008dbed2f5079b84dcbb0c986204`.

- [ ] **Step 1: Recover the current frontier concurrently**

  Launch an audited S04 repair from the preserved head, recover or supersede
  wave 18 using canonical selection identity, and preview S03 integration. Never
  trust the stale S04 `lane_green` file while its proof is `rework`.

- [ ] **Step 2: Canary parallel review**

  Run all three lenses on one known-green task and one known-rework task.
  Require simultaneous start evidence, exhaustive rubric coverage, deterministic
  aggregation, and exact-head immutability.

- [ ] **Step 3: Canary deterministic integration**

  Integrate the smallest dependency-valuable green batch. Require clean
  regeneration, semantic review pass, broad exact-head pass, record validation,
  and promotion.

- [ ] **Step 4: Start the persistent controller at 12 active runs**

  ```bash
  rtk env HOST_TEST_MAX_LOAD_1M=20 pnpm brain:factory:control -- --watch --interval-ms 15000 --max-active 12 --batch-min 5 --batch-max 10 --state .fabro/state/maestro-brain
  ```

- [ ] **Step 5: Ramp only on evidence**

  After two clean batches, raise to 20. Raise toward 24–32 only if one-minute
  load is below 20, provider errors are absent, memory is healthy, and median
  ready-to-launch latency is below 60 seconds.

- [ ] **Step 6: Run factory and repository gates**

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test
  rtk pnpm --dir tooling/brain-factory typecheck
  rtk pnpm brain:factory:check
  rtk fabro validate .fabro/workflows/brain-build-task/workflow.fabro
  rtk fabro validate .fabro/workflows/brain-integrate-wave/workflow.fabro
  rtk host-test-slot --class full pnpm verify
  rtk git diff --check
  ```

- [ ] **Step 7: Record rollout evidence and commit**

  Record throughput, stage timing, aggregate cycles, utilization, gate queues,
  provider health, and rollback evaluation. Commit only the rollout receipt:

  ```bash
  rtk git add docs/superpowers/receipts/maestro-brain/10x-factory-rollout.md
  rtk git commit -m "docs: record 10x factory rollout"
  ```

## Completion Audit

- [ ] All seven tasks have passing focused tests and intention-scoped commits.
- [ ] The controller replay test proves no duplicate action or evidence drift.
- [ ] A rework task cannot write `lane_green` before aggregate pass and final
      focused gate.
- [ ] Parallel review canaries prove all three lenses run and aggregate.
- [ ] Integration selection hashes have unambiguous payload/file semantics.
- [ ] The deterministic integrator reproduces generated output at exact head.
- [ ] The dependency contract covers every remaining edge and collision.
- [ ] The controller remains active and continuously feeds dependency-safe work.
- [ ] All 56 task outcomes are reconciled against exact integration evidence.
- [ ] Final acceptance reconciliation and the broad repository gate pass, except
      for explicitly external evidence such as S00-T01 that must be recorded
      rather than fabricated.
