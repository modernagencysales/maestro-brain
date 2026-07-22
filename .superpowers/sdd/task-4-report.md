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
