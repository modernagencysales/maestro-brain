# Maestro Brain Repair-First Fabro Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the existing Brain Factory from one-shot failure reporting
into persistent Fabro coding, review, repair, and integration loops, then use it
to finish the complete Brain task frontier.

**Architecture:** Keep the existing immutable evidence, task locks, isolated
review worktrees, integration generation, and serialized promotion. Add
finding-bound repair, concurrent reviews, direct owner routing, separate coding
and ownership capacity, and an authoritative persistent controller. Represent
the already-approved S05 migration-registry transition as one bounded auxiliary
control lane.

**Tech Stack:** TypeScript, Vitest, Fabro workflow graphs, Git worktrees,
Confect/Convex generation, pnpm, and `host-test-slot`.

## Global Constraints

- Fabro owns coding, focused testing, review, repair, and green-lane proof.
- Normal implementation, focused-gate, or review failure loops to the owning
  implementation node; it is not a terminal workflow result.
- Contract, safety, and quality reviews use isolated worktrees and run with
  `max_parallel=3` and `join_policy="wait_all"`.
- Exact immutable findings bind every repair and every review; prior findings
  must be explicitly resolved before a lane can become green.
- Green lanes retain file ownership but consume no coding slot.
- Unrelated implementation dispatch continues while integration is active.
- Integration routes hand-authored task findings directly to owner-lane repair;
  generated/integration-owned findings alone may use candidate repair.
- Initial capacity is 12 coding lanes, six review workers, one integration
  candidate, and one full-gate slot. Batch target is five to ten tasks.
- Preserve `.mcp.json`, unrelated worktrees, immutable evidence, and MAE-394
  ownership boundaries.
- Do not deploy, run production migrations, ingest, purge, or fabricate proof.
- Every local broad or focused test command runs through `host-test-slot`.
- Each checkpoint is one intention, passes focused tests/typecheck/lint, and is
  committed before the next checkpoint.

---

### Task 1: Restore Concurrent Isolated Reviews

**Work package:** `template-gap`

- Missing pattern: parallel read-only review fan-out over independently managed
  worktrees.
- Backlog reference: repair-first design, “Review Concurrency.”
- Promotion path: retain the generic concurrent review fork in the Brain build
  workflow after canary proof.

**Files:**

- Modify: `.fabro/workflows/brain-build-task/workflow.fabro`
- Modify: `tooling/brain-factory/test/workflow-prompt-contract.test.mts`

**Interfaces:**

- Consumes: existing `review-worktrees.mts` per-lens worktrees and
  `review_merge` wait-all aggregation.
- Produces: one concurrent three-lens fork; no shared writable review state.

- [ ] **Step 1: Change the prompt-contract test to require concurrency**

  Replace the serialization assertion with:

  ```ts
  it("runs isolated exhaustive review lenses concurrently", () => {
    const reviewFork = buildTask
      .split("\n")
      .find((line) => line.trimStart().startsWith("review_fork ["));
    expect(reviewFork).toBe(
      '  review_fork [label="Concurrent Isolated Review", shape=component, join_policy="wait_all", max_parallel=3]',
    );
    expect(reviewFork).not.toContain("max_parallel=1");
  });
  ```

- [ ] **Step 2: Run the test and verify RED**

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test workflow-prompt-contract
  ```

  Expected: failure showing the workflow still contains
  `Serialized Isolated Review` and `max_parallel=1`.

- [ ] **Step 3: Change only the review fork**

  ```fabro
  review_fork [label="Concurrent Isolated Review", shape=component, join_policy="wait_all", max_parallel=3]
  ```

  Keep all three managed review worktrees, review branches, guards,
  `review_merge`, and deterministic aggregation unchanged.

- [ ] **Step 4: Run focused isolation proof**

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test workflow-prompt-contract review-worktrees review-worktree-guard review-lens-guard review-aggregate-refs review-aggregation-lease
  rtk pnpm --dir tooling/brain-factory typecheck
  rtk fabro validate .fabro/workflows/brain-build-task/workflow.fabro
  rtk pnpm exec prettier --check tooling/brain-factory/test/workflow-prompt-contract.test.mts
  ```

  Expected: all focused suites pass and the three-lens fork remains wait-all.

- [ ] **Step 5: Commit**

  ```bash
  rtk git add .fabro/workflows/brain-build-task/workflow.fabro tooling/brain-factory/test/workflow-prompt-contract.test.mts
  rtk git commit -m "fix: run Brain reviews concurrently"
  ```

### Task 2: Bind Reproofs to Complete Findings

**Work package:** `template-gap`

- Missing pattern: immutable finding closure across implementation, independent
  reviews, proof, and final gate.
- Backlog reference: repair-first design, “Finding-Bound Repair.”
- Promotion path: reuse the structured reproof contract for future factory
  owner-lane repairs.

**Files:**

- Modify: `tooling/brain-factory/src/contract-reproof.ts`
- Modify: `tooling/brain-factory/src/failed-integration-rework.ts`
- Modify: `tooling/brain-factory/src/failed-integration-rework-validation.ts`
- Modify: `tooling/brain-factory/src/review-lens.ts`
- Modify: `tooling/brain-factory/src/review-lens-guard.ts`
- Modify: `tooling/brain-factory/src/review-lens-guard.mts`
- Modify: `tooling/brain-factory/src/review-aggregate.mts`
- Modify: `tooling/brain-factory/src/proof.ts`
- Modify: `tooling/brain-factory/src/lane-gates.mts`
- Modify: `.fabro/workflows/brain-build-task/workflow.fabro`
- Test: `tooling/brain-factory/test/contract-reproof.test.mts`
- Test: `tooling/brain-factory/test/contract-reproof-admission.test.mts`
- Test: `tooling/brain-factory/test/failed-integration-rework.test.mts`
- Test: `tooling/brain-factory/test/review-lens.test.mts`
- Test: `tooling/brain-factory/test/review-lens-guard.test.mts`
- Test: `tooling/brain-factory/test/lane-gates.test.mts`
- Test: `tooling/brain-factory/test/workflow-prompt-contract.test.mts`

**Interfaces:**

- Consumes: validated v3 integration `remainingFindings` and selected task
  locks.
- Produces: backward-compatible `maestro-brain-contract-reproof/v2` requests,
  `PriorFindingDisposition` review records, and exact final closure proof.

- [ ] **Step 1: Add RED contract tests for structured findings**

  Define and use these exact types:

  ```ts
  export interface ContractReproofFinding {
    readonly id: string;
    readonly taskId: string;
    readonly candidateHeadSha: string;
    readonly summary: string;
    readonly details: string;
    readonly severity: string;
    readonly affectedPaths: readonly string[];
    readonly expectedBehavior: string;
    readonly requiredRegressionProof: string;
    readonly priorEvidenceSha256: readonly string[];
    readonly changeExpectation: "source_or_test_delta" | "evidence_only";
    readonly evidenceOnlyRationale?: string;
  }

  export interface PriorFindingDisposition {
    readonly findingId: string;
    readonly status: "resolved" | "unresolved";
    readonly evidence: readonly string[];
    readonly regressionTestPaths: readonly string[];
    readonly changedPaths: readonly string[];
  }
  ```

  Tests must reject an empty finding ID, task mismatch, non-SHA candidate,
  affected path outside owner locks, missing expected behavior, missing
  regression proof, duplicate prior evidence hashes, and `evidence_only` without
  a rationale. Existing v1 and refresh-v2 request hashes must continue
  validating byte-for-byte.

- [ ] **Step 2: Run RED contract tests**

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test contract-reproof contract-reproof-admission failed-integration-rework review-lens review-lens-guard lane-gates
  ```

  Expected: failures for missing v2 schema and finding dispositions.

- [ ] **Step 3: Implement the backward-compatible request schema**

  Add `CONTRACT_REPROOF_FINDINGS_SCHEMA = "maestro-brain-contract-reproof/v2"`,
  include sorted `findings`, and hash the complete canonical payload. Preserve
  the v1 and refresh-v2 validators rather than rewriting their payloads.

  `failed-integration-rework.ts` must build findings from validated integration
  evidence instead of reducing them to `reason`. Validation must require every
  `affectedPath` to appear in the exact selected owner lane’s locks.

- [ ] **Step 4: Require every lens to disposition every prior finding**

  Extend review artifacts with:

  ```ts
  readonly priorFindingDispositions: readonly PriorFindingDisposition[];
  ```

  Guards reject missing, duplicate, or unknown IDs. Aggregation resolves an ID
  only when contract, safety, and quality lenses all report `resolved` with
  non-empty evidence.

- [ ] **Step 5: Enforce behavioral closure in final gates**

  For `source_or_test_delta`, compare request affected paths with the exact task
  `baseSha..HEAD` changed paths and require both:

  ```ts
  const changedAffectedPath = finding.affectedPaths.some((path) =>
    changedPaths.has(path),
  );
  const changedOwnedRegressionTest = disposition.regressionTestPaths.some(
    (path) => changedPaths.has(path) && ownedPaths.has(path),
  );
  if (!changedAffectedPath || !changedOwnedRegressionTest) {
    throw new Error(
      `${finding.id}: behavioral reproof lacks code and test delta`,
    );
  }
  ```

  Copy resolved IDs into the proof and reject `write-lane-result` unless every
  prior ID is resolved on the exact final head.

- [ ] **Step 6: Bind workflow prompts and commands**

  The implementation prompt must read `$BRAIN_REPROOF_REQUEST` before editing,
  reproduce every required regression proof, and resolve every stable ID. Each
  review prompt must read the same request and write dispositions. Pass
  `--reproof-request "$BRAIN_REPROOF_REQUEST"` to each lens guard and
  `review-aggregate.mts`.

- [ ] **Step 7: Run focused verification**

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test contract-reproof contract-reproof-admission failed-integration-rework review-lens review-lens-guard lane-gates workflow-prompt-contract
  rtk pnpm --dir tooling/brain-factory typecheck
  rtk pnpm exec prettier --check tooling/brain-factory/src tooling/brain-factory/test .fabro/workflows/brain-build-task/workflow.fabro
  rtk pnpm lint
  ```

- [ ] **Step 8: Commit**

  ```bash
  rtk git add tooling/brain-factory/src/contract-reproof.ts tooling/brain-factory/src/failed-integration-rework.ts tooling/brain-factory/src/failed-integration-rework-validation.ts tooling/brain-factory/src/review-lens.ts tooling/brain-factory/src/review-lens-guard.ts tooling/brain-factory/src/review-lens-guard.mts tooling/brain-factory/src/review-aggregate.mts tooling/brain-factory/src/proof.ts tooling/brain-factory/src/lane-gates.mts tooling/brain-factory/test/contract-reproof.test.mts tooling/brain-factory/test/contract-reproof-admission.test.mts tooling/brain-factory/test/failed-integration-rework.test.mts tooling/brain-factory/test/review-lens.test.mts tooling/brain-factory/test/review-lens-guard.test.mts tooling/brain-factory/test/lane-gates.test.mts tooling/brain-factory/test/workflow-prompt-contract.test.mts .fabro/workflows/brain-build-task/workflow.fabro
  rtk git commit -m "fix: bind Brain repairs to findings"
  ```

### Task 3: Route Product Findings Directly to Owners

**Work package:** `template-gap`

- Missing pattern: deterministic integration finding ownership and automatic
  owner-lane reopening.
- Backlog reference: repair-first design, “Integration Lifecycle.”
- Promotion path: reuse the owner-routing gate for future task factories.

**Files:**

- Create: `tooling/brain-factory/src/integration-finding.ts`
- Create: `tooling/brain-factory/src/integration-owner-rework-check.mts`
- Create: `tooling/brain-factory/src/route-integration-rework.ts`
- Create: `tooling/brain-factory/src/route-integration-rework.mts`
- Modify: `.fabro/workflows/brain-integrate-wave/workflow.fabro`
- Modify: `tooling/brain-factory/src/factory-state.ts`
- Modify: `tooling/brain-factory/src/controller.ts`
- Modify: `package.json`
- Test: `tooling/brain-factory/test/integration-finding.test.mts`
- Test: `tooling/brain-factory/test/failed-integration-rework.test.mts`
- Test: `tooling/brain-factory/test/factory-state.test.mts`
- Test: `tooling/brain-factory/test/controller.test.mts`
- Test: `tooling/brain-factory/test/workflow-prompt-contract.test.mts`

**Interfaces:**

- Consumes: Task 2 structured findings, immutable wave selection, exact result
  hashes, supersession, and existing `reopen --failed-integration` support.
- Produces: `owner_rework` wave state and `route_owner_rework` controller
  action.

- [ ] **Step 1: Write RED ownership-classification tests**

  ```ts
  export type IntegrationFindingOwnerKind = "task" | "integration";

  export interface IntegrationFinding extends ContractReproofFinding {
    readonly ownerKind: IntegrationFindingOwnerKind;
  }
  ```

  Require task-owned findings to name a selected `taskId` and affected paths
  within its locks. Require integration-owned findings to affect only generated
  or integration-owned paths. Mixed or unknown ownership fails closed.

- [ ] **Step 2: Run RED tests**

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test integration-finding failed-integration-rework factory-state controller workflow-prompt-contract
  ```

- [ ] **Step 3: Add the deterministic owner-rework gate**

  `integration-owner-rework-check.mts` validates the exact selection and result
  hashes. It exits successfully only when all remaining findings are task-owned
  and valid for selected lanes. It writes no lane result and certifies no pass.

  Change workflow routing to:

  ```fabro
  review_gate -> owner_rework_gate [label="task rework"]
  owner_rework_gate -> exit [condition="outcome=succeeded"]
  owner_rework_gate -> repair [label="integration repair"]
  ```

  Product defects must never enter `Repair Exact Wave Head`.

- [ ] **Step 4: Add normal-tooling owner routing**

  `route-integration-rework.mts` must:

  1. validate exact wave/result/selection identities;
  2. supersede the failed candidate once through existing tooling;
  3. create one Task 2 finding-bound reproof request per sorted owner;
  4. invoke existing `reopen --failed-integration` for each owner;
  5. preserve unrelated green lanes.

  Add:

  ```json
  "brain:factory:route-rework": "tsx tooling/brain-factory/src/route-integration-rework.mts"
  ```

- [ ] **Step 5: Extend controller state without blocking dispatch**

  Add wave stage `owner_rework` and action `route_owner_rework`. Plan the
  routing action from exact evidence, but do not return a global wait for
  unrelated ready tasks.

- [ ] **Step 6: Run focused verification and commit**

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test integration-finding failed-integration-rework factory-state controller workflow-prompt-contract
  rtk pnpm --dir tooling/brain-factory typecheck
  rtk pnpm exec prettier --check tooling/brain-factory/src tooling/brain-factory/test .fabro/workflows/brain-integrate-wave/workflow.fabro package.json
  rtk pnpm lint
  rtk git add tooling/brain-factory/src/integration-finding.ts tooling/brain-factory/src/integration-owner-rework-check.mts tooling/brain-factory/src/route-integration-rework.ts tooling/brain-factory/src/route-integration-rework.mts tooling/brain-factory/src/factory-state.ts tooling/brain-factory/src/controller.ts tooling/brain-factory/test/integration-finding.test.mts tooling/brain-factory/test/failed-integration-rework.test.mts tooling/brain-factory/test/factory-state.test.mts tooling/brain-factory/test/controller.test.mts tooling/brain-factory/test/workflow-prompt-contract.test.mts .fabro/workflows/brain-integrate-wave/workflow.fabro package.json
  rtk git commit -m "fix: route Brain findings to owners"
  ```

### Task 4: Activate Authoritative Persistent Control

**Work package:** `template-gap`

- Missing pattern: restart-safe live observation and reconciliation with
  independent coding and ownership capacity.
- Backlog reference: approved 10× Task 4 and repair-first design, “Persistent
  Controller.”
- Promotion path: expose the generic watch controller after live canary proof.

**Files:**

- Recover from commit `92d8f312`: `tooling/brain-factory/src/controller.mts`
- Recover from commit `92d8f312`:
  `tooling/brain-factory/test/controller-cli.test.mts`
- Create: `tooling/brain-factory/src/controller-observation.ts`
- Modify: `tooling/brain-factory/src/controller.ts`
- Modify: `tooling/brain-factory/src/dispatch.mts`
- Modify: `package.json`
- Test: `tooling/brain-factory/test/controller.test.mts`
- Test: `tooling/brain-factory/test/controller-cli.test.mts`
- Test: `tooling/brain-factory/test/dispatch-ownership.test.mts`
- Test: `tooling/brain-factory/test/scheduler.test.mts`
- Test: `tooling/brain-factory/test/terminal-archive.test.mts`
- Test: `tooling/brain-factory/test/integration-wave.test.mts`

**Interfaces:**

- Consumes: existing controller planner/executor, Fabro inspect, run records,
  lane results, wave results, supersession/promotion receipts, and terminal
  archive command.
- Produces: `brain:factory:control --once|--watch`, authoritative snapshots,
  immediate re-observation after actions, and separate diagnostics for
  `codingActive` and `owned` tasks.

- [ ] **Step 1: Recover the prior CLI as a baseline**

  ```bash
  rtk git show 92d8f312:tooling/brain-factory/src/controller.mts
  rtk git show 92d8f312:tooling/brain-factory/test/controller-cli.test.mts
  ```

  Read both files completely, then restore those two files with `apply_patch`;
  recover only the `brain:factory:control` package script. Do not retain the
  synthetic `controller-snapshot.json` fallback or the reconciliation
  implementation that returns `unresolved` for every mutating action.

- [ ] **Step 2: Write RED live-observation and capacity tests**

  Tests must prove:

  - terminal Fabro status becomes `terminal`, not `running` or `pending`;
  - inspect failure becomes `unknown` plus a provider error;
  - seven green lanes consume zero coding slots while retaining seven owners;
  - terminal archive is executed and the next tick dispatches without human
    input;
  - a running integration wave does not suppress unrelated dispatch;
  - promotion remains single-owner serialized;
  - two dry runs over unchanged state produce byte-identical output and no
    mutation;
  - SIGINT/SIGTERM ends watch mode cleanly.

- [ ] **Step 3: Implement authoritative observation**

  `controller-observation.ts` reads exact task and wave records, uses
  `fabro inspect --json --quiet` for live status, validates lane admission,
  binds control HEAD and manifest hashes, and derives action reconciliation
  solely from durable artifacts. Provider inspection errors fail closed as
  `unknown`; no task is silently projected as pending.

- [ ] **Step 4: Separate capacity from ownership**

  Define:

  ```ts
  const codingTaskStages = new Set([
    "preparing",
    "running",
    "recoverable",
    "terminal",
    "unknown",
  ]);
  const ownershipTaskStages = new Set([
    ...codingTaskStages,
    "lane_green",
    "false_green",
  ]);
  ```

  Scheduler conflict checks receive all owned task IDs. Available coding slots
  use only live coding stages. Preserve existing `active` output for
  compatibility and add `codingActive` and `owned` diagnostics.

- [ ] **Step 5: Replan immediately after every action**

  The watch loop must observe, plan one action, execute/reconcile it, observe
  again, and continue until only a wait remains before sleeping. This preserves
  current action identity semantics while allowing archive, routing,
  integration, and dispatch to progress in one watch cycle.

- [ ] **Step 6: Select useful green batches**

  Integrate lock-compatible product tasks only, up to ten and normally at least
  five. Flush a smaller batch only when it unlocks a pending true dependency or
  no additional coding work can run. Control-kind lanes never enter
  `integrate-wave`.

- [ ] **Step 7: Run focused verification**

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test controller controller-cli dispatch-ownership factory-state scheduler terminal-archive integration-wave
  rtk pnpm --dir tooling/brain-factory typecheck
  rtk pnpm exec prettier --check tooling/brain-factory/src/controller.ts tooling/brain-factory/src/controller.mts tooling/brain-factory/src/controller-observation.ts tooling/brain-factory/src/dispatch.mts tooling/brain-factory/test/controller.test.mts tooling/brain-factory/test/controller-cli.test.mts tooling/brain-factory/test/dispatch-ownership.test.mts tooling/brain-factory/test/scheduler.test.mts tooling/brain-factory/test/terminal-archive.test.mts package.json
  rtk pnpm lint
  ```

- [ ] **Step 8: Prove dry-run idempotency**

  Run twice:

  ```bash
  rtk pnpm brain:factory:control -- --once --dry-run --state .fabro/state/maestro-brain --max-active 12 --batch-min 5 --batch-max 10
  ```

  Expected: byte-identical planned action and no Git or state mutation.

- [ ] **Step 9: Commit**

  ```bash
  rtk git add tooling/brain-factory/src/controller.ts tooling/brain-factory/src/controller.mts tooling/brain-factory/src/controller-observation.ts tooling/brain-factory/src/dispatch.mts tooling/brain-factory/test/controller.test.mts tooling/brain-factory/test/controller-cli.test.mts tooling/brain-factory/test/dispatch-ownership.test.mts tooling/brain-factory/test/scheduler.test.mts tooling/brain-factory/test/terminal-archive.test.mts tooling/brain-factory/test/integration-wave.test.mts package.json
  rtk git commit -m "feat: activate persistent Brain control"
  ```

### Task 5: Add the S05 Migration-Registry Transition

**Work package:** `template-gap`

- Missing pattern: a green-head integration transition that removes legacy
  executable definitions before canonical generated registry assembly.
- Backlog reference: approved 10× Task 6.
- Promotion path: retain fragment-based generated registry assembly after the
  Brain factory proves the transition.

**Files:**

- Modify:
  `docs/superpowers/plans/2026-07-14-maestro-brain-agency-context-os-implementation-plan.md`
- Modify: `docs/superpowers/execution/maestro-brain/task-manifest.json`
- Modify: `docs/superpowers/execution/maestro-brain/parallelism-contract.json`
- Modify: `tooling/brain-factory/src/manifest.ts`
- Test: `tooling/brain-factory/test/manifest.test.mts`
- Fabro lane lock: `packages/convex/confect/internal/migrations.ts`
- Fabro lane lock: `tooling/brain-factory/src/integration-generated-proof.ts`
- Fabro lane lock:
  `tooling/brain-factory/test/integration-generated-proof.test.mts`

**Interfaces:**

- Consumes: exact green S05-T01 head, existing fragment generator, existing
  integration generation order, and Task 4 controller.
- Produces: auxiliary control transition `S15-T02`, mandatory same-wave ordering
  after S05-T01, and byte-reproducible `migrations.generated.ts` generation.

- [ ] **Step 1: Write RED manifest tests for a green-head transition**

  Require `S15-T02` to declare:

  ```json
  {
    "taskId": "S15-T02",
    "kind": "control",
    "classification": "template-gap",
    "sourceSliceBudget": 300,
    "sourceSliceLimit": 1,
    "gateProfiles": ["convex", "tooling"],
    "fileLocks": [
      "packages/convex/confect/internal/migrations.ts",
      "tooling/brain-factory/src/integration-generated-proof.ts",
      "tooling/brain-factory/test/integration-generated-proof.test.mts"
    ],
    "greenHeadAfter": "S05-T01",
    "mandatorySameWaveAfter": "S05-T01"
  }
  ```

  The validator rejects a normal integrated dependency on S05 because that would
  deadlock the transition.

- [ ] **Step 2: Run RED manifest tests**

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test manifest scheduler integration-wave
  ```

- [ ] **Step 3: Add the bounded auxiliary contract**

  Amend the canonical plan and generated artifacts deterministically. The
  original 57 deliverable tasks remain the product completion contract; S15-T02
  is an explicitly counted auxiliary control transition.

- [ ] **Step 4: Validate and commit the contract checkpoint**

  ```bash
  rtk pnpm brain:factory:materialize
  rtk pnpm brain:factory:check
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test manifest scheduler integration-wave
  rtk pnpm --dir tooling/brain-factory typecheck
  rtk git diff --check
  rtk git add docs/superpowers/plans/2026-07-14-maestro-brain-agency-context-os-implementation-plan.md docs/superpowers/execution/maestro-brain/task-manifest.json docs/superpowers/execution/maestro-brain/parallelism-contract.json tooling/brain-factory/src/manifest.ts tooling/brain-factory/test/manifest.test.mts
  rtk git commit -m "docs: authorize migration registry transition"
  ```

- [ ] **Step 5: Launch the dedicated Fabro coding loop**

  Root the lane at the exact green S05-T01 head. Its first regression test must
  prove registry generation is invoked before Confect generation and is
  byte-reproducible.

  In `migrations.ts`, remove only the legacy
  `Migrations`/component/schema/stable key imports, `componentMigrations`,
  `probeExpand`, `probeFail`, `stableTenantOrganizationKeysExpand`, and
  `stableTenantWorkspaceKeysExpand`. Preserve receipt, cursor, lease, hashing,
  and coordinator helpers.

  Do not hand-edit or lane-commit
  `packages/convex/confect/internal/migrations.generated.ts`; integration owns
  it.

- [ ] **Step 6: Run focused lane gates**

  ```bash
  rtk host-test-slot --class focused pnpm --dir packages/convex exec vitest run test/migration-registry.test.ts test/migrations.test.ts
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test integration-generated-proof lane-ownership manifest scheduler integration-wave
  rtk pnpm brain:factory:check
  rtk pnpm brain:factory:check-confect-codegen
  rtk pnpm --dir tooling/brain-factory typecheck
  ```

- [ ] **Step 7: Integrate S05 and its transition together**

  Run one non-production candidate ordered S05-T01 then S15-T02. Integration
  alone generates `migrations.generated.ts`, proves byte-identical regeneration,
  and runs authoritative gates. Do not execute migrations or deploy.

### Task 6: Canary and Run the Repair-First Factory

**Work package:** `template-gap`

- Missing pattern: audited rollout of a repaired control plane over preserved
  live lanes.
- Backlog reference: repair-first design, “Immediate Recovery Order.”
- Promotion path: retain the controller only after it proves convergent task
  repair and sustained frontier throughput.

**Files:**

- Evidence only: `.fabro/state/maestro-brain/**`
- Update:
  `docs/superpowers/receipts/maestro-brain/repair-first-factory-rollout.md`

**Interfaces:**

- Consumes: Tasks 1–5, preserved lane heads/worktrees, and authoritative host
  gates.
- Produces: convergent S04 proof, integrated S05 transition, 12–20 active coding
  loops, batched green integrations, final verification, and durable handoff.

- [ ] **Step 1: Canary S04 finding closure**

  Route wave-000056’s complete tenant-key finding into S04-T04. Require the
  regression test to prove an admin authorized by the durable organization ID
  can use its agency key without cross-tenant leakage. The reproof must change
  the affected implementation and owned test and pass all three reviews.

- [ ] **Step 2: Canary concurrent review isolation**

  Inspect the Fabro event stream and review refs. Require simultaneous lens
  activation, separate review worktrees, exact shared candidate head, and one
  deterministic aggregate.

- [ ] **Step 3: Start persistent control at 12 coding lanes**

  ```bash
  rtk env HOST_TEST_MAX_LOAD_1M=20 pnpm brain:factory:control -- --watch --interval-ms 15000 --max-active 12 --batch-min 5 --batch-max 10 --state .fabro/state/maestro-brain
  ```

  Run it in a durable local session. Do not use an interactive model wait loop
  as the controller.

- [ ] **Step 4: Ramp on evidence**

  After two clean batches, raise coding capacity to 20 if provider errors are
  absent, one-minute load is below 20, and median ready-to-launch latency is
  below 60 seconds.

- [ ] **Step 5: Keep every slot productive**

  The controller continuously archives terminal records, routes findings, fills
  coding slots, integrates compatible green batches, and immediately dispatches
  newly unblocked tasks. A product finding must return to its owner without
  blocking unrelated coding.

- [ ] **Step 6: Complete authoritative integration and handoff**

  After all 57 deliverable task contracts are legitimately terminal, reconcile
  acceptance, run final repository gates through `host-test-slot`, promote only
  through the authorized integration path, and record exact candidate/head SHAs,
  receipts, rollback evidence, external actions, and remaining blockers.

## Final Verification

```bash
rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test
rtk pnpm --dir tooling/brain-factory typecheck
rtk pnpm brain:factory:check
rtk host-test-slot --class full pnpm verify
rtk git diff --check
rtk git status --short
```

Expected: all factory tests and typecheck pass, the manifest and generated
parallelism contract byte-match the canonical plan, full repository verification
passes on the exact final candidate, and only the preserved `.mcp.json` remains
untracked in the controller worktree.
