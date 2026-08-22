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
- **BE2-S1C frozen contract:** `transcript-adapter-order-v1` is the only
  accepted adapter-order version. New observations persist it on both the
  immutable revision and current-unit pointer. The registered
  `backfillTranscriptRevisionOrder` / resume mutations own the run generation,
  opaque cursor, pinned server-time population, and 1-10 row batch boundary.
- **BE2-S1C derivation:** an existing compatible stored order is admissible. A
  missing manual-import order derives only to reconciliation epoch `1` for its
  single immutable snapshot. A missing live Granola order derives only from the
  exact stored `providerMetadataJson.updatedAt` evidence selected by the frozen
  adapter. Fireflies, Gong, Fathom, tombstone, unknown-version, and otherwise
  incomplete legacy rows are not guessed from `createdAt`, `receivedAt`,
  revision identity, or content novelty.
- **BE2-S1C conflicts and receipt:** every scanned unit writes one typed audit
  item. Equal-order/different-content history, missing provider version or order
  evidence, ambiguous tombstone/recreation history, corrupt current pointers,
  excessive history, and a concurrent source-population generation remain
  blocking conflicts. A second bounded validation pass compares the exact
  current revision tuple. Only a zero-conflict close persists the one immutable
  receipt with processed, backfilled, excluded, and conflict counts plus the
  rolling population digest. A blocked run has no completion digest and reports
  `readyForPromotion: false`; later narrowing or projection promotion must
  consume a successful receipt.

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
- **Eligibility-fence expand:** add `retrievalEligibilityFences`, keyed by
  organization, fence kind, and stable controller identity. Add optional,
  bounded `eligibilityFences` manifests to the populated publication-set table.
  New page publishers populate a lifecycle reference immediately, and page
  archive advances that fence generation to ineligible in the same mutation as
  the source lifecycle change. Slack/transcript object lifecycle, policy/route,
  and connection writers adopt the same substrate in BE1-S2B. Provider-neutral
  scope and allowlist controllers arrive with their owning records in BE2-S1B;
  BE1 does not invent placeholder controllers.
- **Publication-job authority backfill:** new BE1-S2C writers persist the
  origin-discriminated subject/incarnation, scope when applicable, controlling
  generations, eligibility refs, observation/reconciliation fence, stable effect
  key, and repair/supersession linkage. BE2-S1A resumably inspects legacy jobs.
  Terminal-success rows remain historical; an actionable row is replaced by one
  exactly linked complete-envelope job and marked superseded, or remains a typed
  blocking conflict when authority cannot be derived. Missing fields are never
  guessed in place.
- **BE2-S1A execution:** operators start the internal
  `migrateLegacyPublicationJobAuthority` mutation with the expected live
  projection-population generation and configuration digest, then call the
  resume mutation with the server-issued run key and run generation. Batches are
  limited to 1-10 rows and advance only with the stored opaque cursor over
  `by_workspace_brain_job`; callers cannot supply or rewrite a scan cursor. The
  start transaction pins a server-time scan high-water, so replacements and
  other jobs created after the run starts are outside its population. Repeating
  start with the same configuration returns the existing run. A different active
  configuration or stale generation fails with a typed conflict.
- **BE2-S1A close receipt:** every in-population job contributes its stable key,
  prior status/authority digest, and classified outcome to a rolling SHA-256
  predecessor digest. Progress separately counts processed rows, linked
  replacements, already-complete authority, terminal history, and conflicts. A
  replacement is created and the legacy actionable row is superseded in one
  mutation; each replacement batch also advances the live projection-population
  generation. The run closes `complete` only with zero conflicts and then
  persists one immutable receipt binding the run/configuration generations, scan
  high-water, final population generation and digest, all counts, and completion
  time. Any conflict closes the run `blocked` without a completion receipt.
  Later publications may advance the live generation but never rewrite the
  successful migration receipt; promotion must bind to that receipt and
  independently prove no actionable incomplete-authority job remains.
- **BE2-S1B provider-neutral controllers:** add `connectorScopes`, keyed by the
  stable connector scope, and immutable `connectorAllowlistGenerations`, keyed
  by scope plus allowlist generation. A document publication is controlled by
  the exact document-lifecycle, connector-scope, allowlist-generation, and
  connection tuple captured by its source revision. The rollout rejects missing
  tuple members, duplicate controller rows, mismatched organization or
  connection generations, non-current allowlists, and fence-key/controller
  collisions; it never substitutes provider-specific policy records for these
  identities.
- **BE2-S1B execution and population:** after the immutable publication-subject
  and job-authority receipts exist, operators start `eligibility_fences` through
  the same internal projection-backfill mutations and server-issued run CAS. The
  run scans current then retained retired sets at a pinned high-water, captures
  a second high-water, catches up both states, and validates both populations.
  Per-set run markers make counting idempotent and correct a set's
  current/retired census if it changes state during the scan. A new set created
  after the scan high-water is included only through the bounded catch-up; later
  live population advances restart validation without rewriting the scan.
- **BE2-S1B conflicts, invalidation, and close receipt:** every retained set
  must resolve to one canonical manifest of stable controller identities and
  current fence generations. A malformed origin/controller tuple or collision
  adds a blocking conflict and produces no receipt. If a controller generation
  or tuple changes after that run backfills a set, validation terminates the run
  as `superseded`, also without a receipt, so operators restart from the new
  live generation. A retired set may be excluded only by a canonical
  `citationInvalidationReceipt` bound to its organization, workspace, Brain,
  publication-set key, reason, and invalidation time; invalid receipts are
  conflicts. Zero-conflict close writes one immutable receipt binding the run,
  configuration, scan/catch-up high-waters, population digest, exact current and
  retained-retired counts, backfilled and explicitly invalidated counts, and
  fence-backfill generation. Later publications may advance the live population
  but cannot mutate this completion receipt.
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
- **Eligibility-fence verify:** suppress every cleanup scheduler invocation,
  archive a current page, then simulate a stale writer restoring the old source
  state and prove search and exact source-get remain closed. Missing,
  duplicated, excessive, ineligible, or generation-mismatched references fail
  closed. Eligibility-preserving content or policy republication retains its
  captured generation.
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
- **Eligibility-fence contract:** legacy sets may omit the manifest during the
  expand and compatibility phases only. BE2 backfills the complete required
  fence-kind manifest for every current set and every retained retired set that
  remains citation-addressable, records a monotonic fence-backfill generation,
  and proves zero incomplete sets in that population. BE3 binds its same-SHA
  promotion receipt and compare-and-set mutation to that generation. Projection
  promotion and projection-mode reads fail closed on an absent or incomplete
  required manifest. Retired historical sets outside the retained citation
  window are explicitly invalidated before exclusion; they are never silently
  omitted from the backfill population.
- **Rollback:** stop publication scheduling and route reads to the compatibility
  page path. The provider/page ledgers remain untouched. Derived publication
  rows may be retained for diagnosis and rebuilt later; rollback never deletes
  source revisions.
- **Publication-subject rollback:** older readers ignore the additive subject
  table and optional keys. Preserve subject rows and generation history; never
  delete them during rollback because doing so can reset a later restore.
- **Eligibility-fence rollback:** older binaries may ignore the additive table
  and optional manifests only while projection reads are disabled. Preserve the
  fence rows and generations. If compatibility reads cannot enforce equivalent
  lifecycle and controller eligibility, rollback disables Ask Apero instead of
  exposing legacy evidence.

## Brain read compatibility gate

- **Expand:** add `brainReadModes`, keyed by stable workspace and Brain, with a
  monotonic mode generation. BE1 accepts only `compatibility` and `disabled`.
- **Backfill:** none. An absent row deliberately means `compatibility`, so the
  deployment cannot expose the retrieval projection merely because rollout state
  has not been written yet.
- **Read behavior:** public, HTTP, and MCP reads use the compatibility reader in
  both the absent-row and explicit-`compatibility` states. `disabled` fails with
  `SubsystemDisabled`. Projection reads remain internal validation operations
  and are not published in the headless manifest.
- **Contract:** deferred to BE3. BE3 adds the receipt-bound, compare-and-set
  promotion operation and only then introduces a projection mode after the
  required same-SHA and corpus-completeness evidence has been verified.
- **Rollback:** set the Brain to `disabled` if compatibility reads are unsafe;
  otherwise remove or retain its `compatibility` row. Do not invent or backfill
  a projection state during rollback.

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

## Provider reconciliation and ingestion obligations

- **Expand:** add `connectorIncrementalCursors`, `connectorPageEnvelopes`,
  `connectorPageChunks`, `connectorReconciliationRuns`,
  `connectorReconciliationSeen`, `brainRequiredScopeIntents`, and
  `ingestionObligations`, plus the internal provider-reconciliation mutation
  contract. These are additive tables keyed by the stable connector scope,
  connection generation, allowlist generation, and reconciliation-run
  generation; no existing connector-scope row shape is assumed.
- **Backfill:** none. Existing immutable Slack source revisions and transcript
  unit revisions remain valid. Reconciliation creates required intents, run
  receipts, seen markers, and obligations only for newly opened runs.
- **Flow:** a run advances through
  `scan -> traversal_closed -> apply_removals -> drain_derived -> complete`.
  Each page first pins an immutable envelope and ordered chunk descriptors. A
  chunk transaction verifies its canonical digest and exact immutable
  Slack/transcript ledger rows, then writes all seen markers, ingestion
  obligations, and the receipt. The cursor advances only after every declared
  receipt exists. Removal inference is unavailable before traversal close and
  ignores ledger observations newer than the run high-water.
- **Closure:** only `complete` and `policy_excluded` are successful obligation
  states. Normalization, quarantine, target resolution, capacity, publication,
  retry, failure, removal, and derived-drain states remain blocking. Final close
  also requires the current required-scope intent and zero removal/drain cursor
  or backlog. Activation and restore record the required intent in their owning
  transaction; ordinary deactivation does not erase it, and only the explicit
  generation-fenced decommission operation may retire it.
- **Verify:** run `test/provider-reconciliation.test.ts` and prove successor-run
  and obsolete-tuple fencing, exact immutable page chunks before cursor advance,
  rejection of substituted chunks, successful-close-only removals below the
  ledger fence, every unresolved obligation class remaining nonterminal, final
  close waiting for removal/drain backlogs, and distinct Slack/transcript origin
  and membership identities.
- **Contract:** keep the reconciliation tables and internal mutations additive
  while live runs establish complete traversal, obligation, removal, and drain
  receipts for every required provider scope. Narrowing or switching coverage
  readers is deferred until those current-tuple runs close successfully.
- **Rollback:** pause new reconciliation runs and their workers. Retain
  immutable source ledgers, cursors, envelopes, chunk receipts, seen markers,
  required intents, and obligations for diagnosis and safe resume. Never infer
  removals from a partial, failed, superseded, or rolled-back run.

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
