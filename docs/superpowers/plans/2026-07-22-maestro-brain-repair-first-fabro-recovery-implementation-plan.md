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
finding-bound repair, isolated reviews, direct owner routing, separate coding
and ownership capacity, and an authoritative persistent controller. Represent
the already-approved S05 migration-registry transition as one bounded auxiliary
control lane. Add a distinct manifest-bound transition for aligned final-pass
lanes whose task contract is unchanged but whose proof names an older plan.

**Tech Stack:** TypeScript, Vitest, Fabro workflow graphs, Git worktrees,
Confect/Convex generation, pnpm, and `host-test-slot`.

## Global Constraints

- Fabro owns coding, focused testing, review, repair, and green-lane proof.
- Normal implementation, focused-gate, or review failure loops to the owning
  implementation node; it is not a terminal workflow result.
- Contract, safety, and quality reviews use isolated worktrees and
  `join_policy="wait_all"`. On Fabro 0.254.0, agent-node siblings sharing one
  fork parent thread must run with `max_parallel=1`: repeated production runs
  started three sessions, activated exactly one, and ended the other two within
  about 200 ms. Task lanes remain parallel. Restore `max_parallel=3` only after
  an agent-node canary proves all three sibling sessions activate and finish.
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
- Keep generic authority refresh strict. Plan-only authority is available only
  to S06-T01, S11-T02, and S13-T02 through exact generated manifest records.
- A modeled authority transition waiting on prerequisites retains ownership but
  does not globally block unrelated dependency dispatch or consume coding
  capacity.
- Do not deploy, run production migrations, ingest, purge, or fabricate proof.
- Every local broad or focused test command runs through `host-test-slot`.
- Each checkpoint is one intention, passes focused tests/typecheck/lint, and is
  committed before the next checkpoint.

---

### Task 1: Keep Isolated Agent Reviews Convergent

**Work package:** `template-gap`

- Missing pattern: reliable agent-session fan-out over independently managed
  worktrees.
- Backlog reference: repair-first design, “Review Concurrency.”
- Promotion path: keep the generic fork serialized until an agent-node canary,
  rather than the existing command-node canary, proves sibling-session support.

**Files:**

- Modify: `.fabro/workflows/brain-build-task/workflow.fabro`
- Modify: `tooling/brain-factory/test/workflow-prompt-contract.test.mts`

**Interfaces:**

- Consumes: existing `review-worktrees.mts` per-lens worktrees and
  `review_merge` wait-all aggregation.
- Produces: one wait-all three-lens fork that executes every isolated review; no
  shared writable review state.

- [x] **Step 1: Change the prompt-contract test to require convergence**

  Replace the serialization assertion with:

  ```ts
  it("serializes isolated agent reviews until Fabro supports sibling sessions", () => {
    const reviewFork = buildTask
      .split("\n")
      .find((line) => line.trimStart().startsWith("review_fork ["));
    expect(reviewFork).toBe(
      '  review_fork [label="Serialized Isolated Review", shape=component, join_policy="wait_all", max_parallel=1]',
    );
    expect(reviewFork).not.toContain("max_parallel=3");
  });
  ```

- [x] **Step 2: Run the test and verify RED**

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test workflow-prompt-contract
  ```

  Observed: failure showed the workflow still contained
  `Concurrent Isolated Review` and `max_parallel=3`.

- [x] **Step 3: Change only the review fork**

  ```fabro
  review_fork [label="Serialized Isolated Review", shape=component, join_policy="wait_all", max_parallel=1]
  ```

  Keep all three managed review worktrees, review branches, guards,
  `review_merge`, and deterministic aggregation unchanged.

- [x] **Step 4: Run focused isolation proof**

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test workflow-prompt-contract review-worktrees review-worktree-guard review-lens-guard review-aggregate-refs review-aggregation-lease
  rtk pnpm --dir tooling/brain-factory typecheck
  rtk fabro validate .fabro/workflows/brain-build-task/workflow.fabro
  rtk pnpm exec prettier --check tooling/brain-factory/test/workflow-prompt-contract.test.mts
  ```

  Observed: 57 focused tests, typecheck, targeted lint/formatting, and Fabro
  validation passed. The three-lens fork remains wait-all.

- [x] **Step 5: Commit**

  ```bash
  rtk git add .fabro/workflows/brain-build-task/workflow.fabro tooling/brain-factory/test/workflow-prompt-contract.test.mts
  rtk git commit -m "fix: serialize Brain review agents"
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

### Task 6: Add Final-Pass Plan-Only Lane Authority

**Work package:** `template-gap`

- Missing pattern: exact reauthorization of an unchanged, final-pass lane after
  canonical plan-only drift.
- Backlog reference: repair-first design, “Final-Pass Plan-Only Authority
  Transition.”
- Promotion path: retain the generic transition type for future generated
  factories, but authorize only the three exact Brain task records in this plan.

**Files:**

- Modify:
  `docs/superpowers/plans/2026-07-14-maestro-brain-agency-context-os-implementation-plan.md`
- Modify: `docs/superpowers/execution/maestro-brain/task-manifest.json`
- Modify: `docs/superpowers/execution/maestro-brain/parallelism-contract.json`
- Modify: `tooling/brain-factory/src/manifest.ts`
- Create: `tooling/brain-factory/src/plan-only-lane-authority.ts`
- Create: `tooling/brain-factory/src/plan-only-lane-authority-admission.ts`
- Create: `tooling/brain-factory/src/plan-only-lane-authority-launch.ts`
- Modify: `tooling/brain-factory/src/authority-transition-cli.ts`
- Modify: `tooling/brain-factory/src/resume.mts`
- Modify: `tooling/brain-factory/src/controller-observation.ts`
- Modify: `tooling/brain-factory/src/factory-state.ts`
- Modify: `tooling/brain-factory/src/controller.ts`
- Modify: `.fabro/workflows/brain-build-task/workflow.fabro`
- Test: `tooling/brain-factory/test/manifest.test.mts`
- Test: `tooling/brain-factory/test/plan-only-lane-authority.test.mts`
- Test: `tooling/brain-factory/test/plan-only-lane-authority-launch.test.mts`
- Test: `tooling/brain-factory/test/controller.test.mts`
- Test: `tooling/brain-factory/test/controller-cli.test.mts`
- Test: `tooling/brain-factory/test/workflow-prompt-contract.test.mts`

**Interfaces:**

- Consumes: the three historical final-pass lane/proof/gate tuples, current
  manifest task contracts, current integrated-prerequisite evidence, existing
  deterministic replay helpers, and the normal `BrainBuildTask` workflow.
- Produces:

  ```ts
  export interface PlanOnlyLaneAuthorityTransition {
    readonly schemaVersion: "maestro-brain-plan-only-lane-authority/v1";
    readonly fromPlanSha256: string;
    readonly taskBlockHash: string;
    readonly sourceRunId: string;
    readonly sourceBaseSha: string;
    readonly sourceHeadSha: string;
    readonly sourceTreeSha: string;
    readonly sourceCommits: readonly string[];
    readonly sourceCommitPatchSha256s: readonly string[];
    readonly laneResultSha256: string;
    readonly ciProofPacketSha256: string;
    readonly laneGateReportSha256: string;
    readonly requiredIntegratedTaskIds: readonly string[];
  }

  export interface PlanOnlyLaneAuthorityAdmission {
    readonly mode: "plan-only-lane-authority";
    readonly taskId: string;
    readonly fromPlanSha256: string;
    readonly currentPlanSha256: string;
    readonly taskBlockHash: string;
    readonly sourceBaseSha: string;
    readonly sourceHeadSha: string;
    readonly sourceTreeSha: string;
    readonly sourceCommits: readonly string[];
    readonly sourceCommitPatchSha256s: readonly string[];
  }
  ```

- CLI:
  `brain:factory:resume -- --task <id> --plan-only-authority --state .fabro/state/maestro-brain`.
- Controller stages: `authority_transition_ready` and
  `authority_transition_waiting_prerequisites`; action
  `resume_plan_only_authority`.
- Shape budgets: each new TypeScript source file is at most 300 lines; each
  existing TypeScript file changes by at most 150 lines; the Fabro workflow
  changes by at most 40 lines; the workflow prompt-contract test changes by at
  most 120 lines; no function added or modified by this task exceeds 100 lines.
  If one boundary cannot fit, split the responsibility into another named file
  and add its focused test before implementation. Do not waive these limits.

- [ ] **Step 1: Write RED manifest parser and projection tests**

  Add a canonical “Plan-only lane authority registry” outside every
  `### Sxx-Txx` task block. Give S06-T01, S11-T02, and S13-T02 one exact JSON
  entry each. Tests require exact keys, schema, SHA formats, unique task IDs,
  ordered unique commits, equal commit/digest cardinality, and
  `requiredIntegratedTaskIds` byte-equal to the task’s `codeStartAfter`.

  Assert for every authorized task:

  ```ts
  expect(transition.fromPlanSha256).not.toBe(manifest.planSha256);
  expect(transition.taskBlockHash).toBe(task.taskBlockHash);
  expect(historicalProof.taskBlockHash).toBe(task.taskBlockHash);
  ```

  The registry parser must reject S05-T01 and S13-T03 entries. S05 remains a
  dual-history ownership reproof; S13-T03 remains ownership rehome.

- [ ] **Step 2: Run the manifest tests and verify RED**

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test manifest plan-only-lane-authority
  ```

  Expected: failure because the registry, manifest field, and transition parser
  do not exist.

- [ ] **Step 3: Add the exact generated transition records**

  Extend `BrainTaskContract` with:

  ```ts
  readonly planOnlyLaneAuthorityTransition?: PlanOnlyLaneAuthorityTransition;
  ```

  Parse the registry after task-block hashing and project each entry onto its
  task. Do not include registry text in any task block. Materialize the manifest
  and parallelism contract deterministically; the manifest remains 58 contracts
  (57 deliverables plus the existing auxiliary control task).

  Pin these historical authorities and heads:

  | Task    | Historical plan                                                    | Task hash                                                          | Base                                       | Head                                       | Tree                                       |
  | ------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------ | ------------------------------------------ | ------------------------------------------ |
  | S06-T01 | `728d42dd7400f864894ed6abddee214c5d445931c91059fd389ba43350a17de8` | `f2f6cb348272c704636b7e21bf8e8cbd66b812835d781b52e01bdcfa5b0fa97c` | `64b5d90e9dce6146ac6cd49696658cd9a40a254c` | `02c3ee79adba3239a55cb0928853d2e4efa248d3` | `7764d28ece57572d207af09a2287dda695f461ef` |
  | S11-T02 | `e0256a16a8e0791a68c0f2eef39946ddb845c01a79e186c9aa05585ce85d5199` | `f49e5fe055896a804408cf0013f1f4b02735f7b6e18f1813ab85e85672fb569d` | `8fa1f5b6183a42207628d51cd396852dc8a95af5` | `61d82eebf44c69f52680a649a4f42ab31e02ddd7` | `e38631cad13fdc4552d802d9069ff0995966af7c` |
  | S13-T02 | `cf2e2d6eaca2f6a7c2317efae372f3081564ae73127da9f4ff67af6423289665` | `2b76ab1991d07a9978da3c321cbcc4f73ffc5ae9b4e3eb3512e2ff3dd4251072` | `f66236e12f93bc254cc2350800a5b2a69d0caff5` | `efc6da6647816263d85e7e94c02f2fe04273c566` | `c5d3266dcbdf1a7689061de23e0b6c78cc8f586b` |

  Use these exact remaining registry fields. The patch digests are SHA-256 over
  `git show --format= --binary --no-renames <commit>` bytes; the evidence hashes
  are SHA-256 over the preserved file bytes:

  ```json
  [
    {
      "taskId": "S06-T01",
      "sourceRunId": "01KXYX8E74VJ6XPM629VVMPYH5",
      "sourceCommits": [
        "36451f36986a74c542767e53f149478af04f226c",
        "f4c2848a778794bc8f2d6fecc2d3f52815bd0129",
        "296f9dc83bf5d20f1f0e66080447d33e46f1bfd0",
        "02c3ee79adba3239a55cb0928853d2e4efa248d3"
      ],
      "sourceCommitPatchSha256s": [
        "28eb0ba6393786bf9279cecd679a21ff7e26aa5dd3735becf7322209613f1fd8",
        "fc7bac2cdd7d8efa79157533413bcab5a2424296fa0e75f3a4d71b0b7037dd59",
        "e11d79dd8bac286c06cdb43a697130c9d0b79790b4296e94b5afada911b8142d",
        "eed6663ab3fa516aa23b69baf01338782619c18347b9aed3b837caefcf0bbe49"
      ],
      "laneResultSha256": "f39392a56225f0c3fa31f7ed55cbfdbc792a4f7974a74380664fa70885178283",
      "ciProofPacketSha256": "70b8f1cf430823b954260a0528404ca00e9b2b9b0a2ee480350f917411490d43",
      "laneGateReportSha256": "6a64faa6f7f9342bae6936d1bbfaec2441c72e835f021c80928d7fe4d65b2077",
      "requiredIntegratedTaskIds": ["S05-T01"]
    },
    {
      "taskId": "S11-T02",
      "sourceRunId": "01KY0129952Y9Q549YA9FQH56B",
      "sourceCommits": [
        "54ac37d0a9264035c0674a9eac5a27c67bd0eba9",
        "22d3f58a4bc647cc6dffd6a02cf2bc05c3dd2758",
        "4eb362e40d5905d13ae23c30867256505ae0a9d0",
        "71d65641365770fedd98912d73ab2f16e5aac2b5",
        "93efac62720ade749e4cc88c12ae392130b2d91f",
        "3bc72e158f2ee0f5a22c4b6561fdd8f57ef06f8d",
        "52cdcc28f5b91bb2399c07bc98e17c7c952570aa",
        "a49c1c0a91d950d3f38f51211471bc78e5be8700",
        "a0923ffae652250eea4ab1eeee9f990e62d8e2d1",
        "61d82eebf44c69f52680a649a4f42ab31e02ddd7"
      ],
      "sourceCommitPatchSha256s": [
        "04481a7745f0e389979e4a8cc5fa76557f8eb2b6f1cdcec0ddc42ef7ea4bf001",
        "502ff96a26e50a45219d171b91d55c7f229bc3abb7f31084a6224095699fad19",
        "98611dae9ba1d35d28fb39461bd5ef163677272d7094ec1e6354ade25a4429d1",
        "49f2ac507e9b7a780a7022fbcd1513624c4b0f15bd2eaa7d8320e99e0f324eae",
        "ec32e467813f54278a8c651a2718d7142d985a3faaea3c17abe85c2eb21c18cd",
        "38e2f29f2cbee7dcceccd200c8c7997d205a346398bc867f711fde2aacb38692",
        "1c3c4bf1547ab448a33e0adb859e9418e847bf5cf4e7a4180da6e43ce9a9d208",
        "f0aac8ff6f14a0e9a4521366ad5ef3ae5b47cc1ac1567ba1e288c056650deca4",
        "ba2bd8125a2966bc092af7ccffeb1e69740c98d0da0b7660a43331336da411ec",
        "f6eac28de2bfa5401c266938e9b8601f60a72def8354d5ba835d0eec15b42d2a"
      ],
      "laneResultSha256": "993f42f5acebe9ac866439ab31aa418f8ec9ff5cefd1ca37f38bb1b166dbe5e3",
      "ciProofPacketSha256": "eefa278f5c134cf54a0213574f01165a9c4e009b0484d7cc87687bbedf10a576",
      "laneGateReportSha256": "c80e5813a2bd35bc88902ef26d205c165c84a2983b924bc4f274732ed3fa6d3f",
      "requiredIntegratedTaskIds": [
        "S11-T01",
        "S01-T02",
        "S01-T03",
        "S01-T04",
        "S02-T02"
      ]
    },
    {
      "taskId": "S13-T02",
      "sourceRunId": "01KXYV563E6HNZWH5XTB24WSDR",
      "sourceCommits": [
        "49540c5f759b12b3d7b897d285f4773149505af7",
        "8acec5d81edb9d5efce3e8ad315bd10d308c7c44",
        "a2234bfa0c61c63a85bb538e2eabf35817d29f72",
        "efc6da6647816263d85e7e94c02f2fe04273c566"
      ],
      "sourceCommitPatchSha256s": [
        "cb5c152bb3619c30e6adee50ba5790bfdc85c09afe6ccadc1c35540fc90f87db",
        "72beadb2bc8355cfceb77a86f31a14ac50abd420450ca3f4aae6d6d47a03cc95",
        "8f2635c683402893a1e34c5a3b7f5125fb78142e799f70a923f300796bfb4bdc",
        "a8194eca5029b306e6a93a5c507c764e2eacf59d28d1cae62c5b8b0ced1689ad"
      ],
      "laneResultSha256": "53402821bfcacf79661b89336966295b3a5ce2e3e6d3509be4ef684a1b6cac7d",
      "ciProofPacketSha256": "fa76a3fcbc9ad75b5e63c306e9b2bcb02061444658a8c93b4c6d4a5a38122371",
      "laneGateReportSha256": "b875710575edf3b276de8b303729a39f6a59514e68a94eb74c9f4a5a93706529",
      "requiredIntegratedTaskIds": ["S13-T01", "S06-T02", "S11-T04"]
    }
  ]
  ```

- [ ] **Step 4: Write RED exact-admission tests**

  Table-drive all three authorized tasks. A passing fixture must prove:

  - lane, proof, and gate file bytes match their annotated SHA-256 values;
  - lane is `lane_green` on the annotated head/tree;
  - proof is final `pass`, has `reviewHeadSha === headSha`, and has zero
    `reviewFindings`;
  - gate is final/passed and binds the same head, tree, historical plan, and
    unchanged task hash;
  - historical plan differs from current plan while proof, transition, and
    current task hashes are identical;
  - `base..head` is linear, ends at the annotated head, contains exactly the
    annotated commits and patch digests, stays inside current file locks, and
    satisfies the source-slice contract; and
  - every exact `requiredIntegratedTaskId` is integrated and ancestral to the
    current control head.

  Add one rejection test per invariant, including reordered commits, changed
  evidence bytes, pass-with-findings, stale tree, changed task hash, missing or
  extra prerequisite, out-of-lock path, merge commit, slice overflow, live or
  unknown owner, and preserved `.mcp.json` being the only controller dirt.

- [ ] **Step 5: Run exact-admission tests and verify RED**

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test plan-only-lane-authority manifest
  ```

  Expected: failures for the missing admission and each fail-closed invariant.

- [ ] **Step 6: Implement admission without relaxing generic refresh**

  `admitPlanOnlyLaneAuthority` returns the exact admission interface above and
  has no fallback to `admitAuthorityRefresh`. Leave the existing
  `oldPlanSha256 === currentPlanSha256 || oldTaskBlockHash === currentTaskBlockHash`
  rejection in generic authority refresh unchanged.

  Allow an otherwise clean controller with only `?? .mcp.json`. Reject every
  other staged, tracked, or untracked path.

- [ ] **Step 7: Write RED launch and normal-workflow tests**

  Tests require reserve-before-worktree, full source-lineage identity on crash
  replay, exact candidate HEAD/tree verification before launch, exception-safe
  dispatcher lock cleanup, and recovery of a reservation created before Fabro
  run creation.

  The generated config must select `BrainBuildTask` with
  `resume_mode=plan-only-authority`. Add exact prompt-contract assertions for
  all of the following before changing the workflow:

  ```ts
  const nodeLine = (nodeId: string): string => {
    const line = buildTask
      .split("\n")
      .find((candidate) => candidate.trimStart().startsWith(`${nodeId} [`));
    if (!line) throw new Error(`${nodeId}: workflow node is missing`);
    return line;
  };
  const extract = (line: string, start: string, end: string): string => {
    const from = line.indexOf(start);
    const through = line.indexOf(end, from);
    if (from < 0 || through < 0) throw new Error(`missing ${start}`);
    return line.slice(from, through + end.length);
  };

  const exactCandidateClause =
    'if [ \\"$BRAIN_RESUME_MODE\\" = plan-only-authority ]; then ' +
    'rtk proxy test -z \\"$(rtk proxy git status --porcelain=v1)\\"; ' +
    'rtk proxy test \\"$(rtk proxy git rev-parse HEAD)\\" = ' +
    '\\"$BRAIN_RESUME_EXPECTED_COMMIT\\"; ' +
    "rtk proxy git diff --quiet; rtk proxy git diff --cached --quiet; " +
    "exit 0; fi";
  const preflightClause = extract(
    nodeLine("preflight"),
    'if [ \\"$BRAIN_RESUME_MODE\\" = plan-only-authority ]',
    "exit 0; fi",
  );
  const applyClause = extract(
    nodeLine("apply_archive"),
    'if [ \\"$BRAIN_RESUME_MODE\\" = plan-only-authority ]',
    "exit 0; fi",
  );
  expect(preflightClause).toBe(exactCandidateClause);
  expect(applyClause).toBe(exactCandidateClause);
  for (const clause of [preflightClause, applyClause]) {
    expect(clause).not.toMatch(
      /cherry-pick|--abort|--continue|--allow-empty|git commit/,
    );
  }

  const exactPromptClause =
    "When $BRAIN_RESUME_MODE is plan-only-authority, Plan-only authority is " +
    "replay/review-only: do not edit source or test files. The only permitted " +
    "content write is the task CI proof packet. Do not format, generate, " +
    "amend, commit, cherry-pick, abort, continue, or create empty commits. " +
    "Inspect the exact clean candidate and continue directly to proof handoff.";
  const implementClause = extract(
    nodeLine("implement"),
    "When $BRAIN_RESUME_MODE is plan-only-authority",
    "continue directly to proof handoff.",
  );
  expect(implementClause).toBe(exactPromptClause);

  expect(buildTask).toContain("gates -> review_snapshot");
  expect(buildTask).toContain("review_snapshot -> review_fork");
  expect(buildTask).toContain("review_fork -> review_contract");
  expect(buildTask).toContain("review_fork -> review_safety");
  expect(buildTask).toContain("review_fork -> review_quality");
  expect(buildTask).toContain("review_contract -> review_merge");
  expect(buildTask).toContain("review_safety -> review_merge");
  expect(buildTask).toContain("review_quality -> review_merge");
  expect(buildTask).toContain("review_merge -> review_aggregate");
  expect(buildTask).toContain("aggregate_gate -> final_gates");
  expect(buildTask).toContain("final_gates -> complete");
  ```

  These node-scoped assertions prove that plan-only mode accepts only an
  already-replayed exact clean candidate. The exact shell clause rejects dirty,
  staged, conflicted, or wrong-HEAD worktrees and contains no conflict or commit
  operation. The exact conditional prompt clause forbids source/test edits and
  empty commits. The edge assertions retain the normal gates, serialized
  reviews, final gate, and receipt path.

  A replay conflict occurs in the launch helper before Fabro starts and exits to
  an exact owner-repair finding; the workflow never resolves it or writes a
  green receipt. A successful workflow runs the normal focused gate, all three
  isolated reviews sequentially, aggregate, final gate, proof writer, and
  lane-result writer.

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test plan-only-lane-authority-launch workflow-prompt-contract
  ```

  Expected: RED because `resume_mode=plan-only-authority` is not yet represented
  in the workflow preflight, apply, or implementation prompt.

- [ ] **Step 8: Implement launch, CLI, and recovery**

  Add `--plan-only-authority` as mutually exclusive with every existing resume
  selector. Derive all coordinates from the manifest and preserved evidence;
  reject `--ref`, `--base`, conflict-aware flags, or archive selectors.

  Deterministically replay only the annotated source commits onto current
  control HEAD. Verify every replayed commit’s patch digest against the
  annotation. Do not permit the agent to add a regression test or change source
  merely to produce a new SHA. Fresh proof and receipt bytes come only from the
  normal workflow executing on the replayed candidate.

  Change `workflow.fabro` so the launch helper, not Fabro, owns replay. For
  `BRAIN_RESUME_MODE=plan-only-authority`, `preflight` requires a clean worktree
  and exact `BRAIN_RESUME_EXPECTED_COMMIT`; `apply_archive` repeats those checks
  and exits successfully without cherry-pick, abort, continue, or conflict
  resolution. Every mismatch fails closed back to the launcher/recovery path.

  The `implement` prompt for this mode is replay/review-only. It may inspect the
  candidate and write only
  `$BRAIN_EVIDENCE_DIR/lane-results/$BRAIN_TASK_ID/ci-proof-packet.json` with
  current plan authority and `reviewVerdict="pending"`. It must not edit,
  format, generate, amend, or commit a source or test file. The deterministic
  focused gate and all normal review/final-receipt nodes remain unchanged.

  Run the Step 7 command again. Expected: GREEN with both launch and workflow
  prompt-contract suites passing.

- [ ] **Step 9: Write RED controller deferral tests**

  Tests must prove:

  - ready S11-T02 plans `resume_plan_only_authority`;
  - S06-T01 waits on S05-T01 while unrelated ready tasks still dispatch;
  - S13-T02 waits on exactly S06-T02 and S11-T04 while those chains dispatch;
  - S13-T03 remains `ownership-rehome` and waits on exactly S06-T02, S08-T01,
    S11-T04, and S12-T02;
  - modeled waiting transitions retain ownership and consume zero coding slots;
  - an invalid or unmodeled false green still produces a fail-closed wait; and
  - re-observation immediately schedules the transition after the last
    prerequisite integrates.

- [ ] **Step 10: Implement transition-aware observation and planning**

  Observation classifies a rejected lane only after validating whether its exact
  manifest transition explains the rejection. The controller may defer only a
  cryptographically valid modeled transition. It must not relabel an invalid
  lane merely because a transition field exists.

  Planning prioritizes ready authority transitions, then continues normal
  dependency-safe dispatch for modeled waiting transitions. If nothing can
  progress, the wait receipt names the exact missing prerequisites. Existing S05
  lane-green reproof and S13 ownership-rehome actions keep their distinct
  commands and admission paths.

- [ ] **Step 11: Run focused verification**

  ```bash
  rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test manifest plan-only-lane-authority plan-only-lane-authority-launch controller controller-cli factory-state workflow-prompt-contract
  rtk pnpm --dir tooling/brain-factory typecheck
  rtk pnpm exec prettier --check docs/superpowers/plans/2026-07-14-maestro-brain-agency-context-os-implementation-plan.md docs/superpowers/execution/maestro-brain/task-manifest.json docs/superpowers/execution/maestro-brain/parallelism-contract.json tooling/brain-factory/src/manifest.ts tooling/brain-factory/src/plan-only-lane-authority.ts tooling/brain-factory/src/plan-only-lane-authority-admission.ts tooling/brain-factory/src/plan-only-lane-authority-launch.ts tooling/brain-factory/src/authority-transition-cli.ts tooling/brain-factory/src/resume.mts tooling/brain-factory/src/controller-observation.ts tooling/brain-factory/src/factory-state.ts tooling/brain-factory/src/controller.ts tooling/brain-factory/test/manifest.test.mts tooling/brain-factory/test/plan-only-lane-authority.test.mts tooling/brain-factory/test/plan-only-lane-authority-launch.test.mts tooling/brain-factory/test/controller.test.mts tooling/brain-factory/test/controller-cli.test.mts tooling/brain-factory/test/workflow-prompt-contract.test.mts .fabro/workflows/brain-build-task/workflow.fabro
  rtk pnpm brain:factory:materialize
  rtk pnpm brain:factory:check
  rtk pnpm lint
  rtk git diff --check
  ```

  Expected: exact transition, launch, manifest, and controller suites pass;
  generated artifacts byte-match the canonical plan; generic authority-refresh
  strictness tests remain green.

- [ ] **Step 12: Save two coherent implementation commits**

  First commit the canonical registry, generated manifest projection, parser,
  admission, and focused contract tests:

  ```bash
  rtk git add docs/superpowers/plans/2026-07-14-maestro-brain-agency-context-os-implementation-plan.md docs/superpowers/execution/maestro-brain/task-manifest.json docs/superpowers/execution/maestro-brain/parallelism-contract.json tooling/brain-factory/src/manifest.ts tooling/brain-factory/src/plan-only-lane-authority.ts tooling/brain-factory/src/plan-only-lane-authority-admission.ts tooling/brain-factory/test/manifest.test.mts tooling/brain-factory/test/plan-only-lane-authority.test.mts
  rtk git commit -m "feat: model plan-only lane authority"
  ```

  Then commit launch/recovery, the bounded normal-workflow contract, and
  controller deferral. Before committing, verify the second commit respects the
  per-file and per-function shape budgets above:

  ```bash
  rtk git add tooling/brain-factory/src/plan-only-lane-authority-launch.ts tooling/brain-factory/src/authority-transition-cli.ts tooling/brain-factory/src/resume.mts tooling/brain-factory/src/controller-observation.ts tooling/brain-factory/src/factory-state.ts tooling/brain-factory/src/controller.ts tooling/brain-factory/test/plan-only-lane-authority-launch.test.mts tooling/brain-factory/test/controller.test.mts tooling/brain-factory/test/controller-cli.test.mts tooling/brain-factory/test/workflow-prompt-contract.test.mts .fabro/workflows/brain-build-task/workflow.fabro
  rtk git commit -m "fix: defer modeled Brain authority drift"
  ```

- [ ] **Step 13: Execute in dependency-safe order**

  After the implementation commits pass independent review, run:

  ```bash
  rtk pnpm brain:factory:resume -- --task S11-T02 --plan-only-authority --state .fabro/state/maestro-brain
  ```

  Run S06-T01 only after S05-T01 integrates. Run S13-T02 only after S06-T02 and
  S11-T04 integrate. Do not use this selector for S13-T03; use its existing
  `--ownership-rehome` command after S06-T02, S08-T01, S11-T04, and S12-T02 are
  integrated.

### Task 7: Canary and Run the Repair-First Factory

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

- [ ] **Step 2: Canary serialized review convergence**

  Inspect the Fabro event stream and review refs. Require contract, safety, and
  quality sessions to activate and finish sequentially, with separate review
  worktrees, one exact shared candidate head, and one deterministic aggregate.
  Test future concurrency only in a distinct non-production agent-node canary.
  Restore `max_parallel=3` only when that canary proves all three sibling agent
  sessions activate before any ends and all three finish successfully.

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
