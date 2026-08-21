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

- **Expand:** add `callRouteMappings` and `callRoutingProposals`, including
  optional review-attempt and learned-mapping references. Existing source units,
  Slack routes, and Brain rows are unchanged.
- **Backfill:** none. Routes are created only when a current call revision is
  processed or an editor reviews its proposal.
- **Verify:** require tenant-closed exact matching, idempotent route creation,
  immutable segment gathering, and reviewed model routing in focused tests.
- **Contract:** deferred. No existing route table or Slack classification row is
  removed in this batch.
- **Rollback:** stop routing new calls and deploy readers that ignore both new
  tables. Immutable call revisions remain available for a later retry.

## Call transcript revision ordering

- **Expand:** add required `revisionOrder` to new canonical transcript inputs
  and optional `currentRevisionOrder` / `revisionOrder` fields to the populated
  `sourceUnits` / `sourceUnitRevisions` tables. Provider timestamp order stores
  both normalized UTC time and the exact provider field used. A future complete
  reconciliation may instead use a positive reconciliation epoch.
- **Provider fences:** Fireflies prefers `_nango_metadata.deleted_at`, then
  `updated_at`, then `date`; Gong prefers call/transcript deletion time, then
  call/transcript `updated_at`, then `started`; Fathom prefers deletion time,
  `updated_at`, `recording_end_time`, then `created_at`; Granola prefers
  deletion time, `updated_at`, then `created_at`. Manual imports are
  content-addressed units and use reconciliation epoch 1 for their one immutable
  snapshot.
- **Comparison:** a strictly newer compatible order replaces current. An older
  delivery is appended as an immutable stale observation without changing the
  unit or enqueueing processing. Equal order with different revision identity,
  incompatible order kinds, and existing current rows without an order fail with
  `RevisionOrderConflict`. Tombstones and recreation use the same rule.
- **Backfill:** do not synthesize provider order from `receivedAt` or revision
  ID. Existing current rows without an order remain readable but reject
  replacement until a provider re-observation supplies a reviewed provider
  timestamp or a successfully closed reconciliation supplies an epoch. Backfill
  the immutable current revision and unit pointer together, then verify before
  narrowing the optional stored fields in a later release.
- **Verify:** require v3-before-delayed-v2, duplicate, equal-order conflict,
  tombstone-before-delayed-live, and newer-recreation tests. Confirm stale
  observations create no processing job and current lifecycle generation does
  not advance.
- **Rollback:** deploy the earlier input contract and planner. Optional stored
  order fields remain harmless; do not delete immutable stale observations.

## Grouped call maintenance proposals

- **Expand:** add `brainMaintenanceProposalItems` and optional call, receipt,
  summary, and item-count fields to `brainMaintenanceProposals`. Existing
  single-page proposal rows remain decodable.
- **Backfill:** none. Existing proposals keep their required legacy page fields;
  grouped fields are populated only by newly mined calls.
- **Verify:** require current route, source lifecycle, page revisions, exact
  segment citations, one parent proposal, normalized page items, and a hash-only
  model receipt in focused tests.
- **Contract:** deferred. Legacy single-page proposal fields and readers remain
  supported until grouped review and publication have replaced them in a later
  verified migration.
- **Rollback:** stop call-maintenance workflow starts and deploy readers that
  ignore grouped fields and the item table. Immutable source and receipt rows
  remain intact; no existing proposal needs rewriting.

## Brain-scoped retrieval publication

- **Expand:** add `retrievalPublicationSets`, `retrievalEntries`,
  `retrievalTokens`, `retrievalPublicationJobs`, and `brainCorpusHealth`.
  Writers continue preserving Brain pages, Slack revisions, and transcript
  ledgers as the source of truth. Source mutations enqueue deterministic
  publication jobs transactionally. The Confect cron owned by the backend
  platform runs every minute and schedules at most 20 due pending or retry-wait
  jobs, recovering work not delivered by the initial scheduler invocation.
- **Publication-subject expand:** add `retrievalPublicationSubjects` with one
  current-set pointer and monotonic generation allocator per stable Brain,
  corpus, source/object, route target, and connector scope. Add optional
  `publicationSubjectKey` to populated publication-set and entry tables, plus
  optional `connectorScopeKey` to publication sets. New writers populate these
  fields immediately. On the first post-expand publish or revoke for a legacy
  source, the writer uses the existing indexed, bounded publication history to
  initialize the subject before allocating another generation; BE2 performs the
  complete bounded backfill before narrowing optional fields.
- **Backfill:** enqueue `page_rebuild`, `slack_rebuild`, or `transcript_rebuild`
  publication jobs with batches of at most five source objects. Each successful
  non-final batch transactionally creates the next cursor-keyed job; provider
  re-ingestion is not required. Record processed, published, revoked,
  retry-wait, and dead-letter counts plus final current publication-set keys as
  the deployment receipt. The direct bounded rebuild mutations remain available
  for diagnosis and migration tooling. Existing queued rows remain valid while
  optional cumulative discovered/published counters are added to rebuild
  cursors. Only the successfully completed final Brain-page continuation marks
  page coverage complete. Provider-backed corpora remain partial until their
  provider reconciliation closes successfully. Terminal publication failures
  increment corpus failure health and preserve a degraded reason.
- **Verify:** require exact UTF-8 passage round trips, bounded passages, stable
  keys, durable retry after missing scheduler delivery, stale-revision
  rejection, atomic current-set replacement, removal of retired postings,
  route/lifecycle revocation, all-corpus rebuild, projection search, ContextPack
  assembly, and headless parity. A named Vitest path that reports zero tests is
  not a passing receipt.
- **Publication-subject verify:** require distinct subjects/current pointers for
  one stable document object in two connector scopes, idempotent duplicate
  publication, and generations `1 -> 2 -> revoke -> restore -> 3` without a
  current-pointer reset.
- **Read switch:** deploy additive tables and publishers first. Complete the
  page rebuild, verify corpus-health counts, then enable question-based
  `brain.context.get`. The temporary page-list compatibility path remains only
  for older callers that omit `question` and reports unknown coverage.
- **Contract:** remove the compatibility path only after all installed CLI/MCP
  manifests send a question and the E0 receipt proves the projection contains
  every approved page, Slack route, and transcript route.
- **Publication-subject contract:** keep new fields optional until BE2 has
  backfilled every legacy set/entry and proved one subject row per expected
  logical publication. Only then narrow the schema in a separate migration.
- **Rollback:** stop publication scheduling and route reads to the compatibility
  page path. The provider/page ledgers remain untouched. Derived publication
  rows may be retained for diagnosis and rebuilt later; rollback never deletes
  source revisions.
- **Publication-subject rollback:** older readers ignore the additive subject
  table and optional keys. Preserve subject rows and generation history; never
  delete them during rollback because doing so can reset a later restore.

## Slack provider event ordering and replay lookup

- **Expand:** add the `by_connection_generation_provider_event` index to
  `providerEventReceipts` and optional `sourceModifiedAt` to `sourceRevisions`.
  Existing receipt rows already contain every indexed field. Existing revisions
  remain decodable and fall back to `sourceCreatedAt` until reconciliation or a
  later evidence-preserving backfill supplies provider modification time.
- **Ordering:** new Slack message edits and tombstones use Slack `event_ts` as
  their provider order. The original message `ts` remains the object identity
  and source-created timestamp. Provider event IDs remain identity data, never a
  monotonic edit version. Two distinct observations at the same provider order
  fail as an explicit conflict instead of being ordered lexically by opaque
  event ID. New revisions preserve original message time as `sourceCreatedAt`
  and convert the accepted provider order into `sourceModifiedAt`. Artifact
  lifecycle generation advances from the persisted nested lifecycle on every
  accepted revision.
- **Verify:** deliver newer edit/delete events with lexically smaller event IDs,
  then a delayed older edit. The tombstone remains current and indexed replay
  lookup resolves the exact connection generation without a table scan. The
  existence lookup is bounded to its exact index prefix and tolerates duplicate
  historical receipts, which may predate enforcement of the replay invariant;
  duplicates still cause the incoming event to be rejected as a replay.
- **Rollback:** the additive index may remain. Reverting the reader is safe for
  schema compatibility but restores an unbounded scan and is therefore not an
  approved operational rollback.

## Slack publication target-resolution intent

- **Expand:** add `slackPublicationTargetIntents`, keyed uniquely by the
  immutable provider-event receipt with a bounded status/due index. Existing
  receipts remain unchanged and require no backfill.
- **Flow:** every newly admitted Slack receipt records `pending` target
  resolution in the same transaction as its immutable source revision. Target
  enumeration and publication-job creation run as a separate resumable mutation.
  Capacity or routing ambiguity changes the intent to `retry_wait`; it never
  rolls back source capture and never creates a partial target subset.
- **Backfill:** none for historical receipts. A later reconciliation/rebuild
  covers historical source revisions; only receipts captured after this expand
  participate in the intent sweeper.
- **Verify:** force policy and workspace capacity failures, prove one receipt
  and revision remain with zero publication jobs, remove the capacity condition,
  and resume to the complete target set without provider redelivery. Duplicate
  provider delivery creates no second receipt or resolution intent.
- **Rollback:** pause the resolution sweeper before deploying an older writer.
  The additive intent table may remain. Rebuild derived Slack publications from
  the immutable ledger; never delete captured revisions.

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
