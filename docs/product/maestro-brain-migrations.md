# Maestro Brain Migration Harness

S00-T04 introduces the internal-only migration harness for future Maestro Brain
schema changes. It wraps the mounted `@convex-dev/migrations` component through
Confect specs/impls, durable run rows, and append-only receipt rows.

## Scope

- Classification: `template-gap` for the migrations component pattern.
- Executable probe migrations: `probe.expand` and `probe.fail`.
- Stable tenant expand migrations: `stableTenant.organizationKeys.expand` and
  `stableTenant.workspaceKeys.expand`, routed through typed Confect refs and
  bounded with batch size 1 during proof.
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
payload and does not write target rows. It still writes durable coordinator run
and child/release-parent receipts so rollback evidence remains auditable.
Unknown dry-run component failure is never retried as execute; it durably
appends a failed dry-run child plus `failure_checkpoint` before returning
`MigrationBatchFailed`. Because unknown component failures do not return a
processed count, their receipt records `scanned: 0`, `failed: 1`, nullable
`changed`/`skipped`, and `countProvenance: unavailable`; `0` means no
component-observed processed count was returned, not an inferred scan total.
Execute-mode component failures follow the same durable failure receipt path.

## Call transcript source units

- **Expand:** add `sourceUnits`, `sourceUnitRevisions`, and `sourceSegments`,
  plus optional transcript locator fields and `call_transcript` on citations.
- **Backfill:** none. Existing pilot notes and Slack ledger rows remain valid
  and do not move into the new tables in this batch.
- **Verify:** generate the Confect schema, decode existing note citations, and
  prove deterministic call revision and segment identities in focused tests.
- **Contract:** deferred. Slack-specific source tables remain authoritative for
  Slack capture until a separately proven migration uses the shared seam.
- **Rollback:** deploy readers that ignore the new tables and optional citation
  fields. Existing rows require no rewrite or deletion.

## Call transcript routing

- **Expand:** add `callRouteMappings` and `callRoutingProposals`. Existing
  source units, Slack routes, and Brain rows are unchanged.
- **Backfill:** none. Routes are created only when a current call revision is
  processed or an editor reviews its proposal.
- **Verify:** require tenant-closed exact matching, idempotent route creation,
  immutable segment gathering, and reviewed model routing in focused tests.
- **Contract:** deferred. No existing route table or Slack classification row is
  removed in this batch.
- **Rollback:** stop routing new calls and deploy readers that ignore both new
  tables. Immutable call revisions remain available for a later retry.

Rollback for this harness is to remove the wrapper only after proving no
migration run or receipt rows exist. Product schema migrations must document
their own expand/backfill/verify/contract rollback in their owning task.

Stable tenant rollback checkpoint: verify zero null or duplicate agency/Brain
keys before any reader/writer switch; if rollback is required, restore readers
to legacy IDs while preserving additive keys; restore sensitive dry-run
fail-closed classification before reverting the dependency patch.

## Dry-run log safety

`@convex-dev/migrations` is pinned to `0.3.5` and checked in through pnpm's
patched-dependency mechanism at
`tooling/patches/@convex-dev__migrations@0.3.5.patch`. The patch preserves the
typed dry-run rollback payload but redacts the component's example-change debug
object so before/after documents and customer-bearing fields are never emitted.

Executable dry-run evidence remains server-classified. Probe definitions are
`probeSafeNonSensitive`; stable tenant expand definitions are
`patchedNoRawDocumentLogs`. Missing, unknown, reserved, or otherwise sensitive
definitions fail closed before the component call. Tests install a console
sentinel around stable-tenant dry-run to prove no raw tenant names, before/after
documents, or writes escape the rollback path.
