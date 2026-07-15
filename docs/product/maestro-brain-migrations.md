# Maestro Brain Migration Harness

S00-T04 introduces the internal-only migration harness for future Maestro Brain
schema changes. It wraps the mounted `@convex-dev/migrations` component through
Confect specs/impls, durable run rows, and append-only receipt rows.

## Scope

- Classification: `template-gap` for the migrations component pattern.
- Executable probe migrations: `probe.expand` and `probe.fail` only.
- Reserved future names are server-owned and intentionally non-executable until
  their owning task supplies the idempotent predicate.
- No public, API, CLI, or MCP surface is exposed; callers use generated internal
  Confect refs.

## Run discipline

- Execute mode never accepts caller cursors, `reset`, `next`, raw function
  values, or unbounded batch sizes.
- The server supplies `null` for the first component cursor and resumes only
  from the last committed cursor.
- A durable coordinator leases each run with a monotonic fence generation before
  a batch starts.
- State transitions are `planned -> running -> complete | failed`; a failed run
  may resume only after release/schema/deployment/build preconditions still
  match.

## Receipts

Each batch writes one child receipt with counts, cursor, fence, actor,
deployment/build, and timing metadata. Successful terminal outcomes write
exactly one final `release_parent` receipt with release commit, schema
before/after, parity checks, rollback owner, observation window, and child
hashes in batch-sequence order. Failed terminal outcomes write a
`failure_checkpoint` receipt for that fenced attempt instead of a final release
parent.

Receipt hashes use a recursive canonical serializer and SHA-256, so object key
order does not affect the hash while payload changes do.

## Dry run and rollback

Dry-run success is decoded only from the component's typed `DRY RUN` rollback
payload and does not write coordinator rows, target rows, or receipts. Unknown
dry-run component failure is never retried as execute; it durably appends a
failed dry-run child plus `failure_checkpoint` before returning
`MigrationBatchFailed`. Because unknown component failures do not return a
processed count, their receipt records `scanned: 0`, `failed: 1`, nullable
`changed`/`skipped`, and `countProvenance: unavailable`; `0` means no
component-observed processed count was returned, not an inferred scan total.
Execute-mode component failures follow the same durable failure receipt path.

Rollback for this harness is to remove the wrapper only after proving no
migration run or receipt rows exist. Product schema migrations must document
their own expand/backfill/verify/contract rollback in their owning task.

## Dry-run log safety

The upstream `@convex-dev/migrations` dry-run path logs before/after document
examples from inside the component mutation. Until the template promotes a
patched no-log component boundary, executable dry-run evidence is restricted by
a server-owned migration definition classification. Only definitions explicitly
marked `probeSafeNonSensitive` may invoke upstream dry-run. Missing, unknown,
reserved, or sensitive definitions fail closed before the component call, so
sensitive rows cannot reach upstream debug logs. Promotion backlog: replace this
restriction with a patched/no-log component execution boundary before any
Brain/source or customer-content migration is made dry-run executable.
