# Task 4 Report: Authoritative Persistent Control

## Status

Complete in `/private/tmp/maestro-repair-first-controller` on branch
`codex/repair-first-controller`, based on
`e35f3569e5a6a589df8adff79fe46871fef380e1`.

## Implementation

- Restored only the approved `92d8f312` controller CLI and CLI-test baseline.
- Replaced synthetic snapshot fallback with authoritative observation of task
  reservations, Fabro run status, lane admission artifacts, integration wave
  selection/results, promotion/supersession receipts, control HEAD, manifest
  digest, and live host-test locks.
- Maps terminal Fabro outcomes to `terminal`; inspection failure is redacted and
  projected as `unknown` with an `unavailable/fabro` provider error.
- Separates live coding capacity (`codingActive`) from retained conflict
  ownership (`owned`), while preserving `active` as the compatibility alias for
  owners. Green and false-green lanes retain locks without consuming coding
  slots.
- Allows unrelated coding dispatch while an integration wave or full-gate slot
  is active. Promotion and wave recovery remain single-owner serialized.
- Selects deterministic, lock-compatible product-lane batches up to the policy
  maximum. Smaller batches flush only to unlock a true dependency or when no
  coding work can run. Control lanes cannot enter integration batching.
- Re-observes immediately after every successful action, so terminal archive,
  routing/recovery, integration, and dispatch can advance without a human tick.
  Repeated unchanged action identities stop the inner loop rather than spin.
- Registers `brain:factory:control`, supports `--once`/`--watch`, the
  repair-first `--max-active`/`--batch-min`/`--batch-max` policy flags,
  deterministic dry-run, audited lock recovery, and clean SIGINT/SIGTERM handler
  disposal.

## TDD Evidence

The initial focused run failed for the expected missing behavior:

- running integration produced `integration_active` wait instead of dispatch;
- `taskCapacityDiagnostics` did not exist;
- `controller-observation.js` did not exist;
- dispatch output lacked `codingActive` and `owned`;
- immediate once-mode archive did not replan to dispatch.

The gate/coding independence test was also observed RED before removing the
global gate-queue dispatch block.

## Passing Gates

```text
rtk host-test-slot --class focused pnpm --dir tooling/brain-factory test controller controller-cli dispatch-ownership factory-state scheduler terminal-archive integration-wave
Test Files  8 passed (8)
Tests       198 passed (198)

rtk pnpm --dir tooling/brain-factory typecheck
PASS

rtk pnpm exec prettier --check <Task 4 file list>
All matched files use Prettier code style!

rtk pnpm lint
PASS

rtk git diff --check
PASS
```

The required controller dry-run command was run twice. Both commands exited
zero, their complete output was byte-identical, and `git status --short` was
unchanged. The deterministic action was `dispatch_tasks` for the five currently
ready initial tasks at coding capacity 12.

## Scope and External Effects

- No Fabro run or watch mode was launched.
- No product, MAE-394, production, deployment, migration, ingestion, or purge
  path was touched.
- No shared state was mutated.
- The only worktree setup was an ignored `node_modules` symlink to the existing
  controller checkout dependencies.

## Integration Concern

Task 3's owner-rework action is being developed independently from the same
base. When its checkpoint and this checkpoint are combined, resolve the bounded
`controller.ts` overlap by retaining Task 3's `route_owner_rework` action and
command while preserving this task's capacity, batching, running-wave dispatch,
and immediate-replanning behavior. No live canary has been run by design.

## Review-Finding Closure

The follow-up review findings were reproduced with failing tests and closed in a
second checkpoint:

- Integration reconciliation now validates the exact v2/v3 run record and
  immutable selection, including integration ID, base/control HEAD, selection
  payload/file hashes, selected task-to-head bindings, run ownership, and the
  complete controller action digest. A matching task list alone cannot pass.
- Promotion reconciliation now requires the exact run/selection authority,
  passed result, matching v2/v3 receipt schema and selection hashes, exact
  base/head/run action coordinates, base-to-candidate and candidate-to-current
  ancestry, and absence of the resolved wave from authoritative observation.
- Negative tests independently reject forged raw receipts, changed action IDs,
  changed source heads, changed ownership, changed promotion heads, changed
  selection hashes, and failed ancestry.
- Direct dispatch retains both `lane_green` and `false_green` ownership while
  counting neither as active coding work.
- The watch loop checks `stopRequested` before planning, immediately before
  execution, immediately after execution, and before sleep. A real SIGINT test
  emitted during the first action proves that the next otherwise-ready mutation
  is not executed.
- Green batching now computes a deterministic maximum-cardinality compatible
  product subset. The adversarial regression proves it skips a lexically first
  lane whose conflicts would cap a greedy batch at four and instead reaches the
  available five-lane batch.

Updated verification:

```text
Focused Task 4 suites: 8 passed, 202 tests passed
Tooling typecheck: PASS
Task 4 Prettier check: PASS
Root lint: PASS
Diff check: PASS
Two required dry runs: exit 0, byte-identical, no mutation
```

## Final Authority and Performance Closure

The final review pass added these fail-closed constraints:

- Durable wave authority requires an absolute recorded worktree, a normalized
  non-empty `runIds` history containing the exact active `runId`, and matching
  `integrationResult.integrationWorkdir` before promotion can reconcile.
- Regression cases reject a missing run history, a history containing only a
  different run, a relative worktree, and a result bound to a different
  worktree.
- Maximum-cardinality batch search is restricted to a deterministic, sorted
  20-lane candidate window. This provides a hard upper bound on exact-search
  cost while retaining the adversarial four-versus-five selection behavior.
- A 30-lane conflicting-frontier regression completes below its bounded runtime
  threshold and proves lanes outside the candidate window cannot alter the
  deterministic result.
- False-green ownership now uses the same exported predicate in direct dispatch
  and its behavioral regression feeds that owner into `selectReadyTasks`, where
  it blocks an overlapping candidate.

Final verification after these changes:

```text
Focused Task 4 suites: 8 passed, 204 tests passed
Tooling typecheck: PASS
Task 4 Prettier check: PASS
Root lint: PASS
Diff check: PASS
Two required dry runs: exit 0, byte-identical, no mutation
```
