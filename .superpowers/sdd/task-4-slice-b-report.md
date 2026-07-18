# Task 4 Slice B Report — Replay-Safe Task Ownership

## Outcome

Implemented the Task 4 ownership seam on branch
`codex/task4-slice-b-replay-ownership`, based on `4d78db2`.

Owned source changes are limited to:

- `tooling/brain-factory/src/dispatch-ownership.ts`
- `tooling/brain-factory/test/dispatch-ownership.test.mts`

## Contract

- `archiveTerminalTaskRecord` now accepts an optional controller `actionId`,
  derives a stable fallback when older callers omit it, and uses the stable ID
  as its archive suffix.
- Archive replay validates exact task/run identity, completes a missing audit
  after a rename-before-audit crash, returns a completed replay without a second
  audit entry, and rejects conflicting archive or audit identity.
- `reconcilePreparingTaskReservation` returns exactly `not-launched`,
  `launched(runId)`, `ambiguous`, or `unknown`.
- Zero exact Fabro candidates permits retry, one exact candidate permits
  promotion, multiple exact candidates are ambiguous, and unavailable,
  malformed, branch-drifted, task-drifted, or input-drifted observations fail
  closed as unknown.
- Exact launch admission binds reservation task/branch/workdir/base to the
  candidate's observed branch, Fabro task metadata, and canonical full input
  object. Key order is not identity.

## Verification

Authoritative focused test:

```text
rtk env HOST_TEST_MAX_LOAD_1M=20 host-test-slot --class focused pnpm --dir tooling/brain-factory exec vitest run test/dispatch-ownership.test.mts

Test Files  1 passed (1)
Tests       18 passed (18)
Duration    329ms
```

Static gates:

```text
rtk pnpm exec eslint tooling/brain-factory/src/dispatch-ownership.ts tooling/brain-factory/test/dispatch-ownership.test.mts
PASS

rtk pnpm exec prettier --check tooling/brain-factory/src/dispatch-ownership.ts tooling/brain-factory/test/dispatch-ownership.test.mts
All matched files use Prettier code style!

rtk pnpm --dir tooling/brain-factory typecheck
tsc -p tsconfig.json --noEmit
PASS

rtk git diff --check
PASS
```

No product, generated, control-checkout, or `.mcp.json` file was edited.
