# Task 3 Slice D Report

## Scope

Branch: `codex/task3-slice-d-v3-consumers` Base:
`ccb606db377766512ee2feddd251be9f40587cc1`

Owned implementation:

- `tooling/brain-factory/src/integration-result-check.mts`
- `tooling/brain-factory/src/integration-lane-check.ts`
- `tooling/brain-factory/src/promote-integration-wave.mts`
- `tooling/brain-factory/src/recover-integration-wave.mts`
- `tooling/brain-factory/test/integration-result-check.test.mts`

## Result

- V3 integration results bind the canonical selection payload SHA-256 and the
  exact immutable selection-file SHA-256 independently.
- Payload mismatch, file mismatch, and ambiguous legacy hash fields fail with
  distinct errors.
- Historical v2 selection bytes remain readable through
  `readIntegrationWaveSelection`; a v2 result must pair with a legacy selection,
  and a v3 result must pair with a v3 selection.
- Promotion binds the correct versioned run/result/selection identities and
  writes v3 promotion receipts with both explicit hashes.
- Recovery preserves existing v2 inspection but never recreates missing v2
  selection bytes, creates an initial v2 launch, or launches a replacement v2
  attempt after terminal failure.
- V3 run, result, and promotion consumers reject ambiguous
  `selectionSha256`/`selection_sha256` fields.

## TDD evidence

RED:

```text
test/integration-result-check.test.mts: 8 failures
unexpected integration result schema
```

The v3 fixture and dual-hash cases failed before implementation because the
consumer accepted only result schemas v1/v2. A later focused RED proved an
ambiguous `selectionSha256` field was accepted by a v3 result.

GREEN:

```text
rtk env HOST_TEST_MAX_LOAD_1M=20 host-test-slot --class focused \
  pnpm --dir tooling/brain-factory exec vitest run \
  test/integration-result-check.test.mts

Test Files  1 passed (1)
Tests       34 passed (34)
Duration    22.58s
```

## Static evidence

Passing:

```text
rtk pnpm exec prettier --check <five owned files>
All matched files use Prettier code style!

rtk pnpm exec eslint <five owned files>
exit 0

rtk git diff --check
exit 0
```

Package typecheck is not independently green on the Slice A-only base. It
reports only unmerged Slice C/E ownership files that still dereference the
removed v3 `selectionSha256` field (`integrate-wave.mts`,
`integration-wave-selection-check.mts`, supersession/restoration files and their
test). It reports no Slice D-owned file. The authoritative combined typecheck
must be run after Slices C, D, and E are integrated.
