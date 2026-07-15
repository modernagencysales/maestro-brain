# Maestro Brain Migration Harness

S00-T04 adds the generic expand/backfill migration seam used before stable-key,
source-ledger, or contract-phase table changes. The harness is internal-only: web,
API, CLI, and MCP surfaces do not receive migration refs, and callers cannot pass
raw Convex functions, `reset`, `next`, arbitrary cursors, or unbounded batch
sizes.

## Contract

Named migrations are server-owned literals. The initial reserved names are:

- `reserveStableKeys`
- `reserveBrainKeys`
- `reservePageKeys`

Each run requires `dryRun` or `execute`, release commit, schema before/after
identifiers, deployment/build identifiers, and an accountable system/operator
actor. Batch size is capped at 25. Expand/backfill definitions must be
idempotent and non-destructive; delete/drop/reset work belongs to a later
contract phase with a separate rollback plan.

A batch-run receipt has this redacted shape:

```ts
{
  migrationName,
  mode,
  cursor,
  scanned,
  changed,
  skipped,
  failed,
  complete,
  startedAt,
  finishedAt,
}
```

Execute mode appends the parent release-migration receipt with release commit,
schema before/after, parity checks, rollback owner, observation window,
deployment/build identifiers, actor fields, and child receipt hashes. Receipts
store hashes and counts only; they must not store customer payloads or provider
payloads.

## Resume and safety rules

- Dry runs compute counts and never write migrated rows or receipts.
- Execute mode resumes only from the last committed failed cursor for the same
  migration name, release commit, and schema before/after pair.
- A running latest receipt rejects concurrent starts.
- Cross-release resume attempts and malformed cursors fail closed with
  `MigrationCursorInvalid`.
- Unknown migration names fail with `MigrationNotFound` at the typed Confect
  boundary.
- Batch failures surface as `MigrationBatchFailed` and must leave the last
  committed receipt as the only resume authority.

## Rollback

This task creates the harness only. Roll back by removing the internal Confect
wrapper and receipt table after proving no migration receipts or migration rows
were created in the target deployment. Future product migrations must document
their own dual-write, parity, contract, and rollback steps.
