# Task 3 report: route integration findings to owners

## Status

Complete on `codex/repair-first-owner-routing`.

- Recovery base: `5d199a0b`
- Rebased Task 3 head before this report update: `f1cab472`
- Rebased range: `5d199a0b..f1cab472`
- Worktree: `/private/tmp/maestro-repair-first-owner-routing`
- Worktree state before this report: clean

## Commits

1. `b0dff3bb` `feat: classify Brain finding owners`
2. `a7dc082e` `fix: preserve owner rework terminals`
3. `01ff353b` `fix: exit Brain product rework early`
4. `f62e908d` `fix: route Brain rework without blocking`

Each implementation checkpoint stays below the repository's 300-line source
slice limit; tests are not counted as source.

## Implemented

- Added deterministic `task` versus `integration` finding ownership with exact
  candidate/evidence validation and fail-closed mixed/unknown ownership.
- Added the read-only owner-rework gate. It validates the immutable selection,
  result bytes, candidate head, selected lane locks, and integration-owned
  generated paths. It writes no lane result and certifies no integration pass.
- Changed the wave graph so task-owned product findings exit immediately for
  owner routing; only integration-owned findings enter exact-head repair.
- Added normal tooling that supersedes once, creates finding-bound requests via
  existing failed-integration validation, and invokes existing reopen tooling
  once per sorted owner with `--launch`.
- Represented a successful Fabro owner-rework exit as the explicit immutable
  `owner_rework` run-attempt state. Ordinary succeeded attempts remain
  non-supersedable. The explicit state is accepted only when the exact
  task-owned result validates and is SHA-bound into supersession evidence.
- Added controller `owner_rework` state and `route_owner_rework` action, with
  exact result/selection hashes in action identity and reconciliation.
- Continued unrelated task dispatch in the same controller plan while owner
  routing is the first action.
- Added the necessary bounded observer seam so real terminal Fabro results can
  enter `owner_rework`; this file was omitted from the brief's file inventory
  but is required for executable controller behavior.

## Verification

- RED observed for missing classification, state/action, workflow routing, and
  explicit succeeded-owner-rework terminal support before implementation.
- `rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test integration-finding failed-integration-rework factory-state controller workflow-prompt-contract`
  - PASS: 6 files, 121 tests.
- `rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test integration-wave failed-integration-rework integration-finding factory-state controller workflow-prompt-contract`
  - PASS: 7 files, including the explicit owner-rework terminal contract.
- `rtk pnpm --dir tooling/brain-factory typecheck`
  - PASS.
- `rtk pnpm lint`
  - PASS.
- `rtk pnpm exec prettier --check --ignore-unknown tooling/brain-factory/src tooling/brain-factory/test .fabro/workflows/brain-integrate-wave/workflow.fabro package.json`
  - PASS.
- `rtk fabro validate .fabro/workflows/brain-integrate-wave/workflow.fabro`
  - PASS: 12 nodes, 18 edges.
- `rtk pnpm brain:factory:check`
  - PASS: 57 tasks, ready width 9, 47 gaps, 8 patterns, 2 fixtures.

The brief's literal Prettier command without `--ignore-unknown` was also run.
Prettier returned exit 2 solely because it has no parser for `.fabro` files. All
TypeScript/JSON paths pass Prettier, and the `.fabro` file passes Fabro's
authoritative graph validator.

## External effects and concerns

- No Fabro run launched.
- No product, MAE-394, deployment, migration, production, or shared state was
  touched.
- No remaining functional concern is known. Normal supersession/reopen now has
  focused proof for the actual succeeded Fabro owner-rework exit.

## Review repair

Review findings were resolved in three additional bounded checkpoints:

1. `c52908e` `fix: partition Brain owner rework`
2. `7a7f1d4` `fix: resume Brain owner routing`
3. `3989d5f` `fix: reserve Brain owner repair capacity`
4. `3d0b6e4` `fix: reconcile fast owner repairs`
5. `9c8f0dc` `fix: replay Brain owner supersession`
6. `c499894` `fix: defer oversized owner rework`

The repaired contract now:

- partitions all complete structured findings by sorted selected owner and
  passes a distinct raw-finding SHA to normal reopen tooling;
- filters and signs only that owner's subset in the generated reproof request;
- persists a routing receipt before supersession, then durably records each
  owner's request SHA and new run ID;
- resumes a partial crash from an already-created matching reservation without
  relaunching completed owners;
- rejects reconciliation for the unchanged pre-route `lane_green` state or any
  missing/drifted per-owner routing evidence;
- reserves every pending owner repair from unrelated coding capacity; and
- binds gate, route, observer, and supersession conversion to the exact
  integration worktree HEAD as well as the immutable result and selection
  hashes.

Review-repair verification:

- Focused suite: 8 files, 164 tests passed, including two-owner partition, crash
  replay, unchanged-lane rejection, capacity reservation, and forged-head
  rejection.
- Brain Factory typecheck, repository lint, supported Prettier check, Fabro
  workflow validation, and `brain:factory:check` all passed.
- No Fabro runs or external mutations occurred during review repair.

Final replay/capacity review:

- A retry after supersession materialization now accepts only the exact existing
  owner-rework receipt after validating its augmented run/result evidence,
  immutable selection, reason, result bytes, and worktree-derived candidate
  HEAD. The focused test constructs and replays a real supersession receipt and
  pins the CLI to this validator.
- An owner wave wider than `totalActiveCapacity` is not routed. Unrelated ready
  tasks still dispatch within available capacity, followed by a deterministic
  `owner_rework_capacity_exceeded` wait action.
- Final focused suite: 8 files, 165 tests passed. Typecheck, lint, supported
  Prettier, Fabro validation, and the 57-task factory check also passed.

## Rebase integration

The branch was rebased without conflicts onto recovery head `5d199a0b`. The
rewritten Task 3 commits are:

1. `07e48741` `feat: classify Brain finding owners`
2. `48106692` `fix: preserve owner rework terminals`
3. `977fa302` `fix: exit Brain product rework early`
4. `06b8df76` `fix: route Brain rework without blocking`
5. `c8a8304a` `docs: record owner routing checkpoint`
6. `112d6484` `fix: partition Brain owner rework`
7. `bcb5fa4c` `fix: resume Brain owner routing`
8. `55c2bc1b` `fix: reserve Brain owner repair capacity`
9. `b0ad1d66` `fix: reconcile fast owner repairs`
10. `0af69782` `docs: record owner routing review`
11. `dd0d4970` `fix: replay Brain owner supersession`
12. `4c9f63c7` `fix: defer oversized owner rework`
13. `f1cab472` `docs: record replay-safe owner routing`

The earlier SHAs elsewhere in this report are pre-rebase provenance and are
superseded by this rewritten sequence.

Combined post-rebase verification passed for controller/controller CLI, route,
supersession, dispatch ownership, scheduler, manifest, factory state,
integration wave/recovery/result/broad-gate/generated proof, candidate worktree,
and the focused S05/S15 signed-order apply cases. The matrix preserves Task 4
authority/capacity/batching/replanning and Task 5 green-head atomic apply
semantics while retaining all Task 3 routing behavior.
