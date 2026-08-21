# Apero Company Brain Data-First Implementation Plan

**Status:** engineering execution-ready; release execution blocked. Continue
WP00-WP02 work, but do not merge the canonical read switch, deploy, or begin
dogfood until the phased rollout and completion gates below pass.

**Date:** 2026-08-21

**Specification:**
[Apero Company Brain Product And Technical Specification](./apero-company-brain-spec.md)

**Architecture decision:**
[Apero Company Brain Architecture](./apero-company-brain-architecture.md)

## 1. Goal

Make Apero's real company information flow into one useful Brain, keep it
current, and make it available through the same Ask Apero workflow in Codex and
Claude Code.

The pilot is a data-pipeline and retrieval-quality project. It is not an
identity-platform project. It succeeds when a provider change becomes cited,
retrievable context and later edits or deletions are reflected reliably.

```text
provider change
  -> observe
  -> normalize an immutable revision
  -> route to the Apero Brain
  -> publish for retrieval
  -> retrieve a useful passage
  -> answer with a working citation
  -> reconcile later edits and deletions
```

## 2. Pilot Posture

The pilot deliberately uses a simple trust model:

- one internal Apero agency Brain;
- one to two initial dogfood users, expanding to five;
- trusted teammates with read-only access;
- selected shared containers approved for the whole pilot cohort;
- existing organization/Brain boundary and individual headless keys;
- no provider write actions;
- no per-document provider ACL replication;
- no personal Drive or unrestricted mailbox ingestion;
- no client Brain composition in company-wide answers.

A selected container must be suitable for every member of the pilot cohort.
Mixed/private containers are excluded instead of introducing per-unit ACL
mapping during the pilot. Granular source permissions, delegated identity,
device binding, enterprise retention controls, and multi-Brain composition are
post-pilot hardening unless real pilot use proves one is immediately required.

## 3. Execution Principles

1. Ship the smallest complete data flow before adding source breadth.
2. Preserve provider-specific raw evidence and use one canonical retrieval
   publication and context-assembly path on every surface.
3. Store exact source revisions before model work.
4. Treat normalized text, search indexes, summaries, and embeddings as derived
   projections of the source ledger.
5. Webhooks accelerate ingestion; reconciliation proves completeness.
6. Every connector must demonstrate create, update, move/unshare when relevant,
   delete, resync, and citation behavior.
7. Measure usefulness with real work, not only scripted API success.
8. Do not build semantic retrieval until lexical/structured retrieval misses
   demonstrate the need.
9. Keep tool selection with agents; keep Brain MCP read-only in the pilot.
10. Run an integration gate after each vertical slice, not only at the end.

### Current Engineering Checkpoint

The current backend branch establishes the first retrieval-publication vertical
slice. It provides current-publication identity, truthful freshness, durable
publication jobs, a registered one-minute recovery sweeper, bounded durable
page/Slack/transcript rebuild continuations, Slack-policy and accepted-call
target reconciliation, provider-connection generation fencing, transcript
revision ordering, exact `(publicationSetKey, entryKey)` reads, and immutable
page/Slack/transcript citation verification. Legacy reads require an explicit
per-request opt-in and are disabled by default. The committed focused backend
checkpoint, Convex package typecheck, Confect contracts, and headless-surface
contracts pass. Retrieval now classifies current and retired postings before
applying one bounded budget, supports optional pre-backfill token state, and
fails visibly instead of returning a partial result above capacity.

This remains an implementation checkpoint, not a rollout checkpoint. The full
repository verification gate is red in the transplanted web application. Before
the canonical read switch or dogfood begins, WP02 must prove the correctness
gates below and the full repository gate must pass. A dedicated live Drive test
may begin after the WP02 backend correctness gates pass on a clean branch, but
it cannot be deployed into the pilot while the full gate is red.

- the Convex package typechecks and the focused backend verification gates are
  green;
- current retrieval identity includes the publication set, so retired rows or
  postings can never hide or starve the current publication;
- lifecycle changes reconcile target additions and removals from their owning
  mutations, and organization-wide connection rebuild enumeration paginates
  rather than silently stopping after a fixed workspace count;
- transcript revisions have a provider-specific monotonic ordering or a
  reconciliation fence, so delayed older events cannot become current;
- only a successfully closed reconciliation may report complete coverage, and
  top-level ContextPack freshness is derived from corpus health rather than
  hard-coded current;
- an expected-corpus manifest is outer-joined with corpus health so a required
  corpus with no health row is reported unavailable or unknown, never omitted;
- search, ContextPack, and source-get carry `(publicationSetKey, entryKey)` so a
  citation always reopens the exact current publication rather than an older row
  with the same logical entry key;
- citation opening resolves the discriminated origin back to the immutable
  ledger, verifies normalized offsets and content hash, and returns the source
  locator rather than treating copied projection text as self-validating;
- compatibility reads are explicitly gated and disabled in WP02 acceptance and
  pilot receipts, so an empty projection cannot be masked by legacy reads.

As of 2026-08-21, the original mixed worktree has been separated into two
default-branch-derived streams:

- backend: `codex/company-brain-backend` at `0ccf41c5`;
- UI: `codex/canonical-saas-ui-clean` at `7bcb635e`.

The split is complete, but neither stream is release-ready. The backend full
gate passed on the exact tree committed as `0ccf41c5`: 1,685 coverage tests,
85.05% line coverage, 99.71% type coverage, format, lint, typecheck, Effect
diagnostics, builds, contracts, boundaries, secret checks, generated manifests,
and qlty were green. This is engineering evidence, not a staging promotion
receipt. The UI stream passes lint and tests but fails web typecheck with 264
errors from the incomplete template transplant. The backend stack also combines
additive schema, publication workers, and default projection reads; it must be
separated or feature-gated so deployment cannot switch reads before backfill and
validation. Backend correctness work may continue behind focused gates. Merge
requires a green full gate for each phase, and promotion requires a green
integrated-tip gate and a receipt from the same SHA.

## 4. Pilot Acceptance Contract

For every pilot source, acceptance requires a real-data receipt proving:

| Event                         | Required result                                       |
| ----------------------------- | ----------------------------------------------------- |
| New provider object           | New retrievable revision with a resolvable citation   |
| Provider object edited        | New active revision; old revision remains auditable   |
| Object moved out of allowlist | No longer appears in current retrieval                |
| Object unshared or deleted    | No longer appears after reconciliation                |
| Duplicate delivery            | No duplicate active revision or projection            |
| Connector temporarily fails   | Coverage is reported stale/partial, never current     |
| Full reconciliation runs      | Stored state converges to the provider's allowed set  |
| Same question on two runtimes | Same evidence revisions and materially similar answer |

The pilot does not require perfect answers. It requires that missing, stale, or
insufficient evidence is visible rather than fabricated.

## 5. Evaluation Layers

The evaluation corpus is staged so that early milestones can pass honestly:

- **E0 — existing evidence:** Brain pages, Slack, and transcripts;
- **E1 — document evidence:** the first Shared Drive or equivalent document
  source;
- **E2 — structured context:** the selected CRM or other highest-value
  structured system;
- **E3 — adoption:** real questions asked by dogfood users during normal work.

Schemas, synthetic leakage cases, and sanitized examples may live in Git. Real
questions or answers containing company, client, employee, or commercial data
belong in a restricted evaluation store or Brain, referenced by a version.
Claude Project output is a usability comparator, not the truth label; owners
judge correctness against authoritative evidence.

Each layer measures:

- useful answer rate;
- required evidence recall;
- citation correctness and citation-open success;
- stale/insufficient-evidence behavior;
- update and deletion propagation;
- cross-runtime evidence parity;
- median and tail time to first answer;
- user corrections and fallback to the old Claude Project.

## 6. Milestones

| Milestone | Outcome                                                        | Packages  |
| --------- | -------------------------------------------------------------- | --------- |
| M0        | Current Ask Apero contents and real user questions inventoried | WP00-WP01 |
| M1        | Pages, Slack, and transcripts share one reliable projection    | WP02A-C   |
| M2        | Snapshot-backed Ask Apero starts two-user dogfood              | WP03-WP04 |
| M3        | First new provider passes the complete data-flow contract      | WP05      |
| M4        | First document source passes production-scope E1               | WP06      |
| M5        | Measured gaps justify and accept a structured source           | WP07      |
| M6        | Five-user pilot proves usefulness and adoption                 | WP08-WP09 |
| Later     | More sources, granular controls, and narrow tool actions       | WP10-WP11 |

## 7. Work Packages

### Execution Classification

Repository execution rules apply to every slice below:

| Work package | Classification     | Existing pattern or promotion path                                                                                                                                                                                                                                                                                                        | Focused proof                                                            |
| ------------ | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| WP00-WP01    | `fixture-to-real`  | Replace placeholder migration, evaluation, owner, and freshness values in the existing product packets                                                                                                                                                                                                                                    | document freshness and owner-reviewed E0 receipt                         |
| WP02A        | `template-gap`     | Retrieval publication is new durable Brain-schema infrastructure. `docs/template/how-to-add-brain-schema.md` documents `pnpm template:add-brain-schema -- --name ...`, but that command is not registered in this checkout; track restoration in the template backlog, then promote the validated schema/table pattern into the generator | retrieval publication, Confect contracts, schema migration notes         |
| WP02B        | `template-gap`     | Provider-neutral cursor, reconciliation, rebuild, and run-authority machinery has no generator; implement behind the canonical connector contract, then promote the reusable substrate into the source-type template backlog                                                                                                              | publication, reconciliation, run-race, and cron tests                    |
| WP02C        | `fixture-to-real`  | Replace `brain.pilot` and fixture-backed health/read surfaces with the canonical persisted read API while preserving their Confect contracts deliberately                                                                                                                                                                                 | Brain pilot, headless context, HTTP, manifest, and contract gates        |
| WP03-WP04    | `fixture-to-real`  | Replace snapshot/demo evidence and runtime fixtures with reviewed Apero pages and one shared ContextPack contract                                                                                                                                                                                                                         | snapshot, runtime parity, and compatibility-disabled receipts            |
| WP04-UI      | `fixture-to-real`  | Keep the canonical SaaS UI screens and replace Brain/health fixture adapters with generated Confect refs                                                                                                                                                                                                                                  | web typecheck, lint, tests, build, and backend parity receipt            |
| WP05-WP07    | `template-gap`     | `docs/template/how-to-add-source-type.md` confirms there is no source-type generator. Add the smallest provider adapter and ledger mapping, then promote the provider-neutral pieces to that backlog                                                                                                                                      | source intake, provider fixture, real-provider, schema, and secret gates |
| WP08-WP10    | `fixture-to-real`  | Replace evaluation and health fixtures with real dogfood observations and scoped corpus health                                                                                                                                                                                                                                            | E0-E3, dogfood, health, and exact-SHA rollout receipts                   |
| WP11         | `pattern-instance` | Use `pnpm template:add-capability`, `pnpm template:add-workflow`, and `pnpm template:add-agent` with their matching playbooks                                                                                                                                                                                                             | generated capability/workflow/agent gates plus action receipts           |

No `template-gap` waives a correctness gate. Each gap lands first as a
phase-scoped Company Brain implementation and receives a named template-backlog
issue before its generic pieces are promoted. `pnpm stack:check` applies when a
machine-readable phase plan is checked in; it does not validate this Markdown
delivery plan by itself.

Template-backlog references for this plan are:

- `CB-TG-01`: register and verify the documented Brain-schema generator;
- `CB-TG-02`: promote the provider-neutral cursor/reconciliation/run-authority
  substrate after WP02 proves it;
- `CB-TG-03`: add the missing source-type generator after the first document
  connector proves the required shape.

### WP00 — Inventory The Existing Ask Apero Project

**Timebox:** 1-2 business days

**Outcome:** connector order and migration scope are based on what users
actually rely on today.

Inventory, without committing sensitive exports:

- Claude Project instructions;
- uploaded files and their current authoritative homes;
- recurring questions and workflows;
- any tool behavior users rely on;
- known stale, duplicate, or untrusted material;
- context that exists only inside the Project;
- gaps that currently require manual lookup.

For every approved file or instruction that exists only in Claude, identify the
temporary snapshot-import destination as well as the long-term authoritative
source. The snapshot makes the first Ask Apero useful; it does not become a
second permanent system of record.

Produce `docs/product/apero-company-brain-migration-matrix.md` with:

| Current asset/workflow | Authority | Destination | Owner | Evaluation layer | Pilot required? |
| ---------------------- | --------- | ----------- | ----- | ---------------- | --------------- |

**Exit gate:** the primary Ask Apero user confirms that every material current
capability is migrated, deliberately excluded, or recorded as a known gap.

### WP01 — Freeze Minimum Decisions And Evaluation

**Timebox:** 1-2 business days; may overlap WP00

Decide only what blocks the read pilot:

- company-context owner;
- engineering owner;
- one to two dogfood users and the five-user cohort;
- first shared source container;
- initial source freshness expectations;
- E0/E1/E2 question sets and acceptance thresholds;
- where restricted evaluation data is stored.

Use these defaults unless the owners replace them before the first run:

- 10-20 representative E0 questions;
- at least 80% useful answers for questions whose required evidence exists;
- 100% of displayed citations open the exact cited evidence;
- zero invented citations;
- 100% of controlled create, edit, move/unshare, and delete cases converge;
- median context retrieval at or below two seconds and p95 at or below five
  seconds, excluding model generation;
- a recorded reason for every fallback to the Claude Project.

Gmail, DocuSign document retention, write approval, granular permissions, and
multi-Brain composition default to **not authorized for the pilot** and do not
block M0.

**Exit gate:** E0 can be run reproducibly, each question names the evidence
required to judge it, and the page, Slack, and transcript freshness thresholds
used by WP02C are filled in rather than inherited from hard-coded defaults.

### WP02A — Add The Brain-Scoped Retrieval Publication Contract

**Timebox:** 2-3 engineering days

**Outcome:** provider-specific evidence can publish into one replaceable,
Brain-scoped retrieval projection without rewriting the working raw ledgers.

The repository currently has two incompatible raw evidence models:

- Slack observations use `sourceArtifacts` and `sourceRevisions`;
- calls use transcript-shaped `sourceUnits`, `sourceUnitRevisions`, and
  `sourceSegments`.

Do not generalize either schema in place. Add a derived publication projection:

```ts
type RetrievalEntry = {
  organizationKey: string;
  workspaceId: string;
  brainKey: string;
  publicationSubjectKey: string;
  entryKey: string;
  publicationSetKey: string;
  publicationGeneration: number;
  kind: "page" | "slack" | "transcript" | "document" | "projection";
  corpusKey: string;
  origin:
    | { kind: "page"; pageKey: string; revisionKey: string }
    | { kind: "slack"; sourceKey: string; sourceRevisionKey: string }
    | {
        kind: "transcript";
        unitKey: string;
        unitRevisionKey: string;
        segmentKey: string;
      }
    | {
        kind: "document";
        connectionKey: string;
        connectorScopeKey: string;
        objectKey: string;
        revisionKey: string;
      }
    | { kind: "projection"; projectionKey: string; revisionKey: string };
  originTable: string;
  connectionKey?: string;
  connectionGeneration?: number;
  connectorScopeKey?: string;
  sourceKey: string;
  sourceRevisionKey: string;
  passageKey: string;
  startOffset: number;
  endOffset: number;
  title: string;
  headingPath?: string;
  text: string;
  locator?: string;
  contentHash: string;
  sourceModifiedAt?: number;
  observedAt: number;
  indexedAt: number;
  authority: "authoritative" | "derived" | "advisory";
  authorityPolicyKey: string;
  policyGeneration: number;
  lifecycleGeneration: number;
  routeGeneration: number;
  state: "building" | "published" | "revoked";
};

type EligibilityFenceRef = {
  kind: "lifecycle" | "route" | "policy" | "scope" | "allowlist" | "connection";
  key: string;
  eligibilityGeneration: number;
};
```

Derive `publicationSubjectKey` from workspace, Brain, corpus, stable source or
provider-object identity, stable route target, and connector scope. It is
revision-independent. One source admitted through multiple scopes has one
subject per scope; scopes never share an ambiguous current pointer. Derive
`passageKey` from the immutable origin revision, normalized UTF-8 byte offsets,
and passage content hash. Derive `entryKey` from the publication subject, origin
revision, and passage key, not mutable lifecycle, policy, or eligibility
generations. Rebuilds therefore produce the same logical entry keys. Retrieval
identity is the tuple `(publicationSetKey, entryKey)`; `entryKey` alone is not
sufficient because an eligibility-preserving republish may retain the same
logical entry.

Each publication subject owns exactly one current-set pointer and one monotonic
publication-generation allocator across its entire history. It publishes through
a `RetrievalPublicationSet` with the state sequence
`building -> current | failed`, followed by `current -> retired`. Entries and
postings are built under the inactive set, validated, then made current in the
same transaction that retires the previous set. Failed or partial builds never
change the current pointer.

`RetrievalPublicationSet.state` is the sole authority for which projection is
current. Entry state and token publication state are denormalized index aids and
must be checked against the set; they cannot independently authorize a read.

Immediate revocation uses bounded authoritative eligibility fences rather than
waiting for unbounded derived-row cleanup. Each publication records
`EligibilityFenceRef` values for the controlling page lifecycle, Slack policy,
call route, connector scope, allowlist, and connection. The owning mutation
advances the relevant `eligibilityGeneration` in the same transaction as
archive, route rejection, policy removal, scope removal, or connection
revocation. It advances only on revoke or restore, never on ordinary content
edits or eligibility-preserving configuration changes. Search, ContextPack, and
source-get deduplicate and verify all referenced fences before returning
evidence. Source state and its eligibility fence become ineligible atomically;
async jobs retire and delete derived rows afterward. Losing every scheduled
cleanup invocation must not make revoked evidence readable, while an ordinary
superseded citation remains reopenable.

Add retrieval-entry indexes for:

- `(workspaceId, entryKey)`;
- `(workspaceId, brainKey, state, entryKey)`;
- `(workspaceId, brainKey, publicationSetKey, entryKey)`;
- `(workspaceId, originTable, sourceRevisionKey, entryKey)`;
- `(workspaceId, connectionKey, connectionGeneration, state)`;
- `(workspaceId, connectorScopeKey, state)`.

Default authority is corpus-specific: dated Claude snapshot pages and
Slack/transcripts are `advisory`; reviewed Brain pages are `derived` unless page
policy marks them authoritative; selected Drive operating documents use their
container source policy; typed CRM fields may be `authoritative`. Store the
resolved authority on every publication.

Add a bounded token-posting projection keyed by Brain and normalized token for
pilot lexical search. This avoids table scans and does not introduce semantic
search. Every retrieval entry must point back to an immutable provider or page
revision.

```ts
type RetrievalToken = {
  organizationKey: string;
  workspaceId: string;
  brainKey: string;
  publicationSetKey: string;
  publicationState?: "current" | "retired";
  tokenizerVersion: 1;
  token: string;
  entryKey: string;
  termFrequency: number;
  inTitle: boolean;
  inHeading: boolean;
};
```

Index postings by `(workspaceId, brainKey, token, authorityRank, entryKey)`, by
`(workspaceId, brainKey, publicationSetKey, entryKey)`, and by
`(workspaceId, entryKey)`. Index every unique token in a bounded passage; do not
silently truncate its vocabulary. Passage construction must keep a row within
the declared token capacity or record a visible publication failure. Search must
resolve postings through the current publication set before applying any
capacity limit; retired postings may never consume the live candidate budget.

This package also adds an explicit approved agency-Brain publication target.
Update transcript routing and Slack channel policy so selected internal sources
may target the active agency workspace instead of accepting only client Brains.
An agency target is valid only when it is the organization's active agency
workspace and the selected import/channel policy explicitly names it. With that
policy, `agency_internal` calls route to the named agency Brain. Existing
`agency_internal` or `no_match` proposals are superseded with a new route
generation rather than returned unchanged. Slack channel activation names a
bounded historical backfill start time; it never implies an unlimited history
crawl.

**Candidate files:**

- `packages/convex/confect/tables/retrievalEntries.ts`
- `packages/convex/confect/tables/retrievalTokens.ts`
- `packages/convex/confect/brain/retrievalPublication.spec.ts`
- `packages/convex/confect/brain/retrievalPublication.impl.ts`
- `packages/convex/test/retrieval-publication.test.ts`
- existing transcript and Slack routing files and tests

**Focused gates:**

```bash
pnpm confect:codegen
pnpm --dir packages/convex test test/retrieval-publication.test.ts
pnpm --dir packages/convex test confect/capabilities/routeCallToBrain.test.ts
pnpm --dir packages/convex test test/channel-policies.test.ts
pnpm check:schema-migration-notes
```

**Exit gate:** an approved agency target accepts page, Slack, and transcript
publication fixtures, while every row resolves to the exact originating
revision.

### WP02B — Publish And Rebuild Existing Corpora

**Timebox:** 2-3 engineering days

Implement idempotent publishers for:

- current active Brain-page revisions;
- current active Slack source revisions;
- current active transcript segments with an accepted agency route.

Publication is a derived step after ledger/page commit. A crash between commit
and publication must be recoverable by retry. A transactional outbox or durable
publication job records `publicationSubjectKey`, origin revision, Brain target,
corpus and connector scope, the controlling configuration and eligibility
generations, observation or reconciliation fence, stable effect key, and repair
or supersession linkage. It records attempts, success, terminal failure, and the
effect on corpus health. A one-shot scheduled function with a typed error return
is not a delivery guarantee. Register a recurring internal sweeper, name its
interval and deployment owner, and prove that a pending job converges when its
initial scheduler invocation never runs.

Provider capture and publication-target resolution are separate durable effects.
Once an admitted event is normalized, routing ambiguity, fan-out capacity, or
downstream scheduling failure must not roll back its immutable receipt and
revision. The capture transaction commits the ledger plus one idempotent
target-resolution intent. A resumable worker resolves the complete target set,
records a typed capacity failure when necessary, and atomically creates all
publication jobs or none. Provider redelivery is never required for recovery.
Duplicate delivery while resolution is blocked creates neither a second revision
nor a second intent.

Introduce the provider-neutral reconciliation substrate in WP02 rather than
waiting for the Drive adapter: connector-scope records, incremental cursor
records, reconciliation runs, per-run seen markers, high-water fences, and
resumable phase cursors. Slack and transcripts are the first adapters; WP05
Drive reuses the same contract. Reconciliation state advances only through
`scan -> traversal_closed -> apply_removals -> drain_derived -> complete`.
Partial traversal never infers deletion, observations newer than the fence
survive removal inference, and only the final close plus zero unresolved
publication effects makes the exact scope and generation complete.

Provider and traversal cursors use compare-and-set against their expected
cursor, lease, and run generation. A fetched page advances its cursor only in
the same transaction that commits every observation, revision, membership or
seen marker, and target-resolution intent derived from that page. Fetch success
and downstream publication success never advance the cursor. If a provider page
cannot fit one transaction, durable chunk receipts make the final cursor advance
conditional on every chunk being committed.

Each `(connectorScopeKey, connectionGeneration, allowlistGeneration)` has one
authoritative monotonic reconciliation-run generation and lease. A successor
supersedes older runs. Every apply and close mutation compares the authoritative
run, provider high-water, and internal ledger high-water; an older late run may
not infer removals, overwrite health/counts, or report complete. Removal applies
only to unseen scope-membership edges whose last internal observation sequence
is at or below the run's ledger high-water. Projection rebuilds use the same
successor and terminal-close rule.

The connector scope separately owns one current
`(connectionGeneration, allowlistGeneration)` tuple. Membership edges and seen
markers are versioned by that tuple, and every apply/close mutation compares the
scope-level current tuple as well as the run generation. A run that remains
current only inside an obsolete tuple has no removal or close authority. This
also covers an unchanged provider revision observed by the new tuple without a
new ledger revision sequence.

Add Brain-scoped, bounded enumerators for pages, Slack revisions, and transcript
segments that recreate entries and tokens without provider re-ingestion. New
revisions revoke the prior active publication. Routing-policy changes, accepted
route changes, connection-generation changes, and lifecycle changes enqueue a
target-diff reconciliation that publishes added targets and retires removed
targets. Source lifecycle cleanup includes every derived retrieval table so a
purged origin cannot leave retrievable copied text. Cleanup retires or deletes
retrieval entries and tokens before deleting the final origin/index row needed
to discover them; rebuild enumeration alone is not a purge mechanism.

The required enqueue hooks are the Slack channel-policy mutation, the call-route
review/acceptance mutation, and each provider-connection lifecycle or generation
mutation. Each hook computes the union of old and new targets and durably
rebuilds both sides; relying on a future provider event is not convergence.
Organization-wide target enumeration must use a durable cursor or return an
explicit capacity failure. A fixed `.take(...)` that silently ignores later
workspaces is forbidden.

Transcript ingestion must compare a provider-native monotonic revision/version
or a successfully closed reconciliation epoch. Before implementation, each
transcript adapter records which persisted field supplies ordering, how equal
and older deliveries behave, and how tombstone/recreation is fenced. An unseen
revision key is not, by itself, proof that the observation is newer.

Every source adapter, including Drive, defines `ObservationOrder` independently
from revision identity. The contract specifies duplicate, equal-order conflict,
older delivery, tombstone, recreation, and closed-reconciliation-epoch behavior.

Publication generations are monotonic across the entire logical publication
history, including retire, revoke, restore, and republish. Generation allocation
must inspect or reserve against retired history; removing the current pointer
must never reset the next generation to one.

Rebuild is a convergence operation, not merely enumeration. Each rebuild uses a
fenced snapshot or a high-water mark plus a catch-up phase, then performs a set
difference between authoritative eligible origins and current publications.
Concurrent inserts, updates, archives, and removals cannot be hidden behind a
mutable cursor, and a stranded publication must be retired even when its normal
lifecycle hook was lost.

A terminal dead letter remains unresolved until a repair job or rebuild records
which failed effect it superseded. Health derives from unresolved failures; an
unrelated successful rebuild cannot clear them, and a repaired effect cannot
leave the corpus permanently degraded.

**Required tests:** current-revision replacement, delayed v2 after v3, duplicate
publication, lost initial scheduler delivery followed by automatic sweeper
recovery, scheduler/action failure followed by durable retry, policy-only and
lifecycle-only republish, route/target/connection revocation, tombstone and
purge, and complete rebuild equivalence for all three corpora, plus
existing-call rerouting, bounded Slack backfill, cutoff enforcement, monotonic
generation after revoke/restore, and dead-letter repair attribution. Also force
target-resolution overflow and prove that the receipt, revision, and single
unresolved intent survive; no partial publication-job subset exists; after
capacity is restored the sweeper publishes every intended target exactly once
without provider redelivery.

**Focused gate:**

```bash
pnpm --dir packages/convex test test/retrieval-publication.test.ts
```

**Exit gate:** separate receipts prove pages, Slack, and transcripts each
publish, update, revoke, retry, backfill, and rebuild correctly. Snapshot pages
cannot mask a stranded live corpus, and no failed publication is represented as
a successful scheduler run.

### WP02C — Add Lexical Retrieval And Typed Context Assembly

**Timebox:** 3-4 engineering days

Implement shared Brain-scoped retrieval over the publication projection:

- normalize query tokens using one versioned tokenizer;
- use at most 12 unique query tokens in first-occurrence order;
- fetch the complete posting union for those tokens up to a hard 5,000-posting
  pilot capacity; return an explicit capacity error instead of silently dropping
  postings;
- compute the complete declared ranking score before applying the 40-candidate
  cap; posting summaries must carry every pre-cap scoring input needed to avoid
  discarding a title, heading, term-frequency, authority, or freshness winner;
- retrieve at most 40 fully ranked candidates;
- allow at most three entries from one source revision;
- score token coverage, title/heading matches, authority, and freshness;
- break ties by `entryKey` for deterministic results;
- pin exact entry and source-revision keys before assembly;
- assemble at most eight entries and 64 KiB of UTF-8 text;
- cap each entry at 12 KiB using a query-centered passage window;
- skip an oversized entry only after producing a bounded excerpt;
- return omission counts and reasons.

Token replacement is atomic with publication-set replacement. Search carries
`publicationSetKey` with every candidate and resolves by
`(publicationSetKey, entryKey)`. Revocation makes source state and its
eligibility fence ineligible atomically; retirement of the set and postings may
follow asynchronously. Tests must prove that more than the per-token capacity of
retired postings cannot occupy or starve the active candidate set.

Add a `brainCorpusHealth` projection keyed by workspace, Brain, corpus, and
connector scope. It records coverage status, last successful observation,
publication and reconciliation times, expected freshness threshold, counts, and
degraded reason. Context coverage derives from these records, so zero search
results can be distinguished from unavailable or stale data. Reindexing old
evidence does not refresh its source-observation time. Only a successfully
closed complete reconciliation may set coverage to `complete`; failed or
interrupted runs remain partial/stale. Top-level ContextPack freshness is the
worst required-corpus state, never an unconditional `current` value.

Add a Brain corpus manifest derived from source policy, routing, and connector
scope. Context assembly outer-joins this expected set to `brainCorpusHealth`. An
expected corpus or scope with no health row is `unavailable` or `unknown`; the
presence of a healthy page corpus cannot hide a missing Slack, transcript, or
document corpus. A terminal publication dead letter increments failure health
and records a degraded reason.

Required-corpus and required-scope intent is durable and survives deletion or
deactivation of live policy, route, connection, and scope rows. Such a scope
remains expected and unavailable/degraded until an explicit owner-approved
decommission generation removes the intent. Revocation can never make the health
report improve by making a required scope disappear.

Do not overload one timestamp or generation across four different facts. Keep
explicit records for:

1. the incremental provider cursor/checkpoint;
2. the provider reconciliation run and per-scope seen markers;
3. the projection rebuild run pinned to a ledger high-water mark;
4. publication delivery attempts, unresolved dead letters, and attributed
   repair.

`complete` requires a successfully closed reconciliation for the current
connection, scope, and allowlist generations plus zero due or unresolved
publication failures for that scope. Projection rebuild can prove ledger versus
projection parity but cannot refresh provider observation time or provider
reconciliation coverage. The expected manifest and ContextPack coverage output
carry `connectorScopeKey`, the controlling generation tuple, and whether the
scope is required; aggregation by corpus name alone is forbidden.

`brain.context.get` accepts a question and returns the typed assembled pack
without model generation. Codex and Claude Code synthesize the pilot answer from
that pack. Keep `brain.answers.ask` as a deterministic compatibility/extractive
operation until a separately reviewed model-backed action is needed.

Add a Confect `headlessContextGet` internal query, route HTTP/MCP through it,
and remove the plain duplicate. Update the generated manifest, OpenAPI, MCP,
CLI, and contract tests together. `brain.sources.search`, `brain.sources.get`,
and `brain.context.get` must use the same publication projection. Search, Get,
and Context entries all expose `publicationSetKey`, `entryKey`, `passageKey`,
normalized start/end offsets, origin revision, and content hash. Source-get
requires `publicationSetKey` with `entryKey` for an exact lookup; a
revision-only lookup may deterministically paginate all current eligible
matches, or return a typed capacity overflow, but may not silently stop at a
fixed `.take(...)` or claim exact citation reopening. Tests place more than the
page limit of retired/ineligible matches before the current match. Citation keys
include both publication and logical entry identity.

Exact citation opening does not stop at `retrievalEntries`. It follows the
entry's discriminated origin to the immutable page, Slack, transcript, document,
or projection revision, reproduces the versioned normalization when necessary,
verifies passage offsets and content hash, and then returns the stable provider
locator. A missing or mismatched origin is a typed integrity failure. Add one
resolver and corruption test per origin variant.

Citation availability distinguishes supersession from revocation. A citation
captured before an ordinary content edit or eligibility-preserving policy-only
republish reopens the exact immutable evidence it originally cited and is
labeled `superseded`. Deletion, unshare, lifecycle revocation, or loss of source
eligibility returns a typed revoked/unavailable result and never returns copied
projection text. Search and ContextPack still return only current eligible
evidence.

Legacy transcript and page reads remain a rollback aid only. Put them behind an
explicit compatibility mode, record when it is used, and disable it for WP02
parity, evaluation, dogfood, and pilot receipts.

**Focused gates:**

```bash
pnpm --dir packages/convex test test/brain-pilot.test.ts
pnpm --dir packages/convex test test/headless-context.test.ts
pnpm --dir packages/convex test test/http-request-security.test.ts
pnpm confect:manifest
pnpm check:confect-contracts
pnpm check:headless-surface-contract
```

**Exit gate:** the canonical backend and the transports used by Codex and Claude
Code return the same versioned candidate manifest, citations, freshness,
coverage, and truncation metadata for the same pinned dataset. Web, CLI, and
other adapters must delegate to that contract but presentation parity is not on
the pilot critical path. Every WP02 evidence-matrix row marked `Required` must
be green before the canonical read switch.

### WP03 — Bootstrap And Prove Existing Apero Evidence

**Timebox:** 2-4 engineering days, depending on existing data state

**Dependencies:** WP02A-WP02C completion gates are green. Snapshot material may
be reviewed and imported earlier, but dogfood retrieval uses only the canonical
publication and ContextPack path.

**Outcome:** approved current Ask Apero material produces immediate value while
live Slack/transcript publication is completed in parallel.

Tasks:

1. import approved Claude-only files/instructions as reviewed Brain pages,
   clearly labeled with snapshot provenance and date, never into Git;
2. publish those pages through the shared projection without changing their
   authority;
3. use `brain.context.get` for the thin slice; the skill synthesizes locally,
   cites the exact publication entry and immutable page revision, and displays
   the snapshot date without claiming live freshness;
4. inventory actual Apero sources currently stored;
5. confirm Slack/transcript routing into the agency Brain;
6. identify fake, fixture, unpublished, empty, or stranded source-ledger rows;
7. perform the required approved backfill;
8. validate source revisions and passage citations;
9. verify that one new and one edited Slack/transcript observation becomes
   retrievable without copying it into `brainSources`;
10. verify deletion/unpublication behavior;
11. record current coverage and gaps by discovered, observed, normalized,
    published, failed, and stale counts.

**Exit gate:** the snapshot answers the page-backed E0 subset with resolvable
citations, and separate receipts prove the required Slack and transcript subsets
passed WP02B rather than being masked by snapshot coverage.

### WP04 — Ship The Ask Apero Thin Slice

**Timebox:** 2-3 engineering days

**Outcome:** one to two users can use Ask Apero in Codex and Claude Code during
normal work.

Deliver:

- reviewed `company-context/` vocabulary, source map, and agent guidance;
- one Ask Apero skill contract shared across both runtimes;
- install/configuration instructions using secret names, never secret values;
- one read-only key per installed runtime using the existing key model;
- search/context-first answering with citations, freshness, and abstention;
- a simple `report wrong or stale` feedback path;
- a versioned team manifest listing the Ask Apero skill, endpoint, compatible
  runtime versions, and update/rollback instructions.

Do not build delegated user tokens, device binding, complex role bundles, or
write tools for this milestone.

**Adoption gates:**

- installation completes in 15 minutes or less;
- first cited E0 answer succeeds in both runtimes;
- users complete three real work sessions over at least three working days;
- every failure is classified as missing source, stale source, retrieval miss,
  answer failure, or usability failure.

Start the two-user dogfood here. Agent-side answer synthesis is the pilot path;
it does not wait for `brain.answers.ask` to become model-backed.

### WP04-UI — Complete The Canonical SaaS UI

**Classification:** `fixture-to-real`

**Branch:** `codex/canonical-saas-ui-clean` at `7bcb635e`

Keep the transplanted `maestro-template-saas-ui` screen and shell structure.
Repair its 264 TypeScript errors without replacing canonical screens with a new
design. Then replace only the Company Brain fixture adapters:

- route Brain search, source-get, and ContextPack through generated Confect refs
  for the canonical `brain.readApi`, never `brain.pilot.search`;
- replace the local `/health` report with the scoped `brainCorpusHealth` and
  expected-corpus contract, including unavailable required scopes, freshness,
  backlog, capacity failures, and unresolved effects;
- keep presentation adapters in features and reusable visible UI in canonical
  SaaS UI blocks/primitives;
- preserve loading, empty, partial, stale, unavailable, integrity-failure, and
  typed-capacity states rather than turning them into generic empty screens.

**Primary files:**

- `apps/web/src/features/brain/brain-surface.ts`
- `apps/web/src/features/health/health-surface.tsx`
- their feature adapters, routes, and focused tests

**Focused gates:**

```bash
pnpm --dir apps/web typecheck
pnpm --dir apps/web test
pnpm lint
pnpm --dir apps/web build
```

**Exit gate:** the canonical UI passes typecheck/lint/tests/build and its Brain
and health screens render the same pinned manifest and scope-level health
returned by the backend. This is a product completion gate; it does not block
headless BE1/BE2 data-flow implementation.

### WP05 — Build A One-Container Provider Walking Skeleton

**Timebox:** 3-5 engineering days

**Default source:** one dedicated Shared Drive folder, unless WP00 proves a
different source is more valuable and similarly bounded.

**Dependencies:** WP02A-WP02C are green on a clean branch, including durable
publication retry, all-corpus rebuild, target-diff reconciliation,
active-publication lookup, truthful health, and runtime-transport parity.
Canonical adapter code may be developed behind fake fixtures earlier. A
dedicated live provider acceptance run may begin after those backend gates pass;
canonical reads, shared-environment deployment, and dogfood also require full
repository verification.

Implement the smallest complete connector lifecycle:

```text
discover -> allowlist -> observe -> normalize -> route -> publish
         -> retrieve -> reconcile -> tombstone
```

Requirements:

- one explicitly selected shared container;
- stable provider object and revision identity;
- deterministic text normalization;
- source ledger commit before indexing;
- active publication only after normalization and routing complete;
- incremental cursor plus full reconciliation;
- clear unsupported-file behavior;
- connector health and last-success timestamps;
- no personal Drive ingestion.

The document connector owns a small immutable raw document ledger rather than
reusing Slack or transcript schemas. Its revision includes connection/container
identity, provider object and revision IDs, title, MIME type, normalized text,
source/observed timestamps, content hash, source locator, and tombstone state.
Only after that revision commits does its publisher create `RetrievalEntry`
rows.

The ledger also stores immutable provider observation receipts, normalization
version, cursor lineage, and a permission/scope snapshot hash. Folder membership
is represented by versioned `documentSourceMembershipEdges`; per-reconciliation
seen markers are keyed by connector scope because one object may belong to more
than one approved scope. Do not store one global `lastSeenGeneration` on the
object. Retention classification is recorded with the source revision even
though automated retention enforcement remains post-pilot hardening.

Freeze the Drive-specific lifecycle contract before implementing the live
adapter:

- scope identity is a Shared Drive plus selected folder roots and an allowlist
  generation;
- object identity is the Drive file ID; folder membership is a versioned edge,
  not part of object identity;
- revision identity uses a provider version when it is meaningful, otherwise a
  deterministic export/content hash plus the provider change observation;
- change cursors are owned per drive, connector scope, connection generation,
  and allowlist generation;
- shortcuts are either resolved with a cited target and independent membership
  proof or explicitly unsupported;
- trashed/removed events may tombstone immediately, while permission loss,
  transient 404s, and move-out inference require explicit evidence or a
  successfully closed full reconciliation;
- Google-native exports record the export MIME type and normalization version;
- unsupported MIME types are visible coverage failures, not silently skipped.

Normalize long documents into deterministic heading-aware passages:

- maximum 8 KiB of normalized UTF-8 text per passage;
- split at heading, paragraph, then sentence boundaries in that order;
- use at most 512 bytes of paragraph-aligned overlap;
- derive stable passage keys from origin revision, heading path, ordinal,
  normalized offsets, and content hash;
- retain heading path, normalized byte offsets, and provider locator;
- publish and tokenize every passage independently.

**Candidate files:**

- `packages/integrations/src/googleDrive/`
- `packages/convex/confect/tables/documentSourceObjects.ts`
- `packages/convex/confect/tables/documentSourceRevisions.ts`
- `packages/convex/confect/tables/connectorScopes.ts`
- `packages/convex/confect/tables/connectorReconciliationRuns.ts`
- `packages/convex/confect/integrations/driveSource.spec.ts`
- `packages/convex/confect/integrations/driveSource.impl.ts`
- `packages/convex/test/drive-source.test.ts`

Use a generalized, fenced reconciliation run contract rather than extending the
transcript-only sync state:

```text
open generation at provider high-water mark
  -> enumerate every page -> mark every seen object for this scope
  -> close traversal successfully
  -> apply inferred removals against observations at/before the fence
  -> drain derived revocations
  -> close complete
```

A partial or failed traversal never infers deletion. Incremental cursors and
full-reconciliation generations are independent. Live observations newer than
the reconciliation fence survive removal inference. Coverage remains partial
through the apply and derived-revocation phases; a crash resumes the same run
idempotently and cannot report complete midway through tombstoning.

Add provider-neutral connector scope, cursor, reconciliation-run, and per-run
seen-marker records containing the organization, connection generation,
provider/container key, allowlist generation, reconciliation generation, run
status, start and close timestamps, counts, and last error. Seen state is keyed
by run and connector scope (or its versioned membership edge); the provider
object never stores one global last-completed generation.

**Exit gate:** a dedicated test object passes create, edit, move out, unshare,
delete, duplicate delivery, stale out-of-order delivery, interrupted
reconciliation, completed reconciliation, projection crash/retry, full rebuild,
retrieval, and citation-open tests against the real provider.

### WP06 — Complete The First Document Source And E1

**Timebox:** 3-5 engineering days

Expand the walking skeleton only enough to cover the approved migration matrix:

- selected production folder allowlist;
- required document formats;
- pagination, rate limits, retries, and dead-letter visibility;
- oversized and malformed-object quarantine;
- update/deletion propagation measurements;
- connection and container coverage shown in the UI;
- E1 evaluation questions.

Run this exact integration gate after the slice:

```bash
pnpm check:format
pnpm lint
pnpm --dir packages/integrations test
pnpm --dir packages/convex typecheck
pnpm --dir packages/convex test
pnpm check:confect-contracts
pnpm check:headless-surface-contract
pnpm check:schema-migration-notes
pnpm check:secret-canaries
```

Any known broad TypeScript baseline must be exact, non-expanding, and separate
from new errors.

**Exit gate:** E1 thresholds pass and a teammate can verify the cited passage in
the source document.

### WP07 — Add The Highest-Value Structured Source

**Timebox:** 5-8 engineering days after field mapping is approved

Select this source from WP00 evidence. It will normally be the CRM, but CRM is
not mandatory if another system covers more critical Ask Apero gaps.

For a CRM, start with typed projections for:

- account and contact identity;
- opportunity, stage, owner, and amount/economics;
- next step, renewal date, and last activity when available;
- provider-native ID, observed time, and source locator;
- notes as cited evidence rather than arbitrary projection columns.

Define field-level authority only for the structured facts used by E2. Narrative
conflicts cite competing evidence; the pilot does not need a universal company
knowledge graph.

Apply the same real-provider lifecycle tests used in WP05. Run an integration
gate after the structured-source slice.

**Exit gate:** E2 passes with current typed values and exact source citations.

### WP08 — Continue And Close Two-User Dogfood

**Timebox:** 1-2 calendar weeks beginning at WP04 after WP02A-WP02C are green;
it may overlap WP07 only after dogfood evidence justifies that source

Track:

- real questions and useful-answer rate;
- repeat usage;
- time to first useful answer;
- wrong/stale reports;
- missing-source and retrieval-failure categories;
- fallback to the previous Claude Project;
- estimated weekly maintenance effort.

Fix pipeline or retrieval problems against a new evaluation version. Do not add
a connector merely to make the architecture look complete.

The two-user rollback is intentionally small: disable Ask Apero, pause the new
connector, and return users to Claude. Full queued-job, key, and rebuild
recovery is rehearsed before WP09 expands to five users.

**Exit gate:** both users choose Ask Apero for the covered question set, major
data-flow failures are resolved, and measured gaps determine whether WP07 is
needed.

### WP09 — Run The Five-User Read Pilot

**Timebox:** 1 calendar week

Freeze the deployment revision, connector configuration, team manifest, and
evaluation versions. Issue the remaining read-only credentials and run E0-E3.

Before issuance, rehearse connector pause, leased-job handling, key revocation,
projection rebuild, restoration, and return to the prior workflow.

Accept when:

- evaluation thresholds pass;
- provider edits and deletions converge inside the agreed windows;
- citations open the evidence actually used;
- Codex and Claude Code use the same evidence revisions;
- repeat usage and user feedback support replacing the Claude Project for the
  covered questions;
- the operating burden is acceptable to the named owner.

Choose **accept**, **one bounded extension**, or **rollback**. A successful demo
is not acceptance.

### WP10 — Expand Context Breadth Only From Measured Gaps

After WP09, rank missing-source failures and add one source at a time:

1. selected Monday boards;
2. DocuSign envelope metadata, then approved agreement classes if needed;
3. narrow Gmail labels, mailboxes, or forwarding addresses;
4. Notion only if material authoritative knowledge remains there;
5. semantic retrieval only for demonstrated lexical recall failures.

Every source repeats the WP05 data-flow contract. Granular source ACLs and more
formal retention controls enter here when broader audiences or sensitive source
classes require them.

### WP11 — Add Narrow Agent Actions Later

The Brain remains the centralized read context plane. Agents own which tools
they can request. A server-side capability gateway should own provider
credential custody, authorization, execution, reconciliation, and audit.

Add only one approved write workflow at a time after the read pilot. Keep write
credentials and audiences separate from Brain MCP. Each action requires typed
inputs, preview/confirmation, idempotency, safe retry, and an operator-readable
receipt.

An action accepts the stable provider entity reference and expected provider
revision/version carried by ContextPack. Immediately before preview and again
before execution, the capability gateway reads authoritative provider state and
rejects a stale precondition. It writes the provider system of record only; it
never patches the Brain projection or declares the result fresh. Confirmed,
failed, and ambiguous outcomes receive durable receipts. An ambiguous provider
response triggers read-after-write observation or reconciliation. Only a later
immutable provider observation may advance the ledger and republish ContextPack.
Duplicate execution is idempotent, and connection or scope revocation blocks
both the action and its read-back.

## 8. Recommended Delivery Sequence

Indicative ranges assume one primary engineer with timely business decisions:

| Track | Work                                                      | Indicative elapsed time |
| ----- | --------------------------------------------------------- | ----------------------- |
| A1    | WP00-WP01 inventory, decisions, and E0                    | 2-3 business days       |
| A2    | Review/import WP03 snapshot as unpublished Brain pages    | 1-2 business days       |
| A3    | WP04 skill work behind fixtures; dogfood waits for B3     | 2-3 engineering days    |
| B0    | Restore full gates and split backend rollout phases       | 1-3 engineering days    |
| B1    | WP02A publication schema and agency route                 | 2-3 engineering days    |
| B2    | WP02B durable publishers, reconciliation, and rebuild     | 3-5 engineering days    |
| B3    | WP02C lexical retrieval, context, and surface convergence | 3-4 engineering days    |
| B4    | WP05 Drive walking skeleton                               | 3-5 engineering days    |
| B5    | WP06 Drive production coverage                            | 3-5 engineering days    |
| C     | WP07 structured source only when measured gaps justify it | 1-2 engineering weeks   |
| Pilot | WP08-WP09 dogfood closure and five-user pilot             | 2-3 calendar weeks      |

The WP02 ranges predate the adversarial correctness matrix and are not delivery
commitments. Re-estimate BE1-BE3 after the eligibility-fence, reconciliation,
and scoped-health contracts have executable tests; do not compress a phase by
dropping a required row.

Branch extraction is complete. Finish B0 by restoring the backend 99.7% type
coverage gate, repairing the UI stream independently, and turning the current
backend stack into three promotable phases. Inventory, evaluation capture,
snapshot review, and fixture-only skill packaging may continue in parallel.
Two-user dogfood begins only after B1-B3 pass. Drive adapter unit work may
overlap B2-B3 behind fixtures, but live ingestion begins only after WP02 is
green. Track C is conditional.

Use this merge train rather than promoting the current combined backend stack:

1. **BE1 — expand:** additive schema, writers, eligibility fences, durable jobs,
   and compatibility-preserving reads. Projection reads remain disabled.
2. **BE2 — backfill and observe:** registered operator operations start and
   resume pages, Slack, and transcript projection backfills; an executable
   transcript-order migration runs; live health and metrics prove backlog,
   freshness, capacity failures, and unresolved dead letters.
3. **BE3 — switch:** a per-Brain, schema-compatible read-mode record changes
   from `compatibility` to `projection` only through a compare-and-set mutation.
   The mutation must match the exact validated corpus/config/eligibility
   generation tuple and reconciliation/rebuild high-waters from the same-SHA
   staging receipt, and reject when any relevant watermark advanced or any
   required publication effect is nonterminal or unresolved, explicitly
   including pending, due, claimed, leased, or running work. Validation and
   switching are never two unguarded steps.
4. **UI — independent:** finish the canonical SaaS UI and wire `/health` to the
   live backend contract. This remains required by the product goal, but the
   288-file transplant does not block the headless data pipeline from landing.
5. Remove compatibility code only after pilot acceptance and a separately
   rehearsed rollback window.

### BE1-S1 First Executable Slice — Stable Publication Subjects

**Classification:** `template-gap` (`CB-TG-01`)

**Intention:** add revision-independent publication subjects and preserve one
monotonic generation sequence across publish, replace, revoke, and restore.
Projection reads remain disabled. This slice does not add reconciliation,
health, Drive, operator switching, or UI behavior.

**Tests first:** extend `packages/convex/test/retrieval-publication.test.ts`
with:

1. subject generation `1 -> 2 -> revoke -> restore -> 3+`;
2. two connector scopes for one stable document object receiving distinct
   subjects and current pointers;
3. duplicate/retried publication reusing the same stable effect and subject;
4. retired history preventing generation reset when no current pointer exists.

**Implementation boundary:**

- `packages/convex/confect/tables/retrievalPublicationSets.ts`
- `packages/convex/confect/brain/retrievalPublication.spec.ts`
- `packages/convex/confect/brain/retrievalPublication.impl.ts`
- generated schema/contracts produced by Confect codegen
- `docs/product/apero-company-brain-schema-migration.md` if the optional-field
  migration note is not already covered by the current note

New fields on populated durable tables are optional in BE1-S1. Allocate or
compare the next generation transactionally from subject history; never infer it
only from the current pointer. After a spec/schema change run codegen, then
restore any required hand-written Convex wrappers with `apply_patch`, including
`packages/convex/convex/crons.ts` if codegen removes it.

**Gates and commit:**

```bash
pnpm confect:codegen
pnpm --dir packages/convex test test/retrieval-publication.test.ts
pnpm check:schema-migration-notes
pnpm check:confect-contracts
pnpm --dir packages/convex typecheck
just verify-full
```

Commit only this intention as `fix: preserve publication subject history`.
BE1-S2 then adds eligibility-fence storage and lost-cleanup fail-closed tests.
Later WP02C slices address deterministic revision-only pagination and complete
pre-cap ranking as separate intentions.

BE2 must expose documented, registered operations equivalent to
`startProjectionBackfill`, `resumeProjectionBackfill`,
`backfillTranscriptRevisionOrder`, and `pausePublicationWorkers`. Names may
follow repository conventions, but operators may not be required to call test
helpers or manually invent cursor loops.

Freeze these operator semantics before implementation:

- `startProjectionBackfill` accepts Brain, corpus/scope, expected configuration
  tuple, and bounded batch size; it creates or returns the one idempotent active
  run and its server-owned cursor.
- `resumeProjectionBackfill` accepts the run key, expected run generation, and
  bounded batch size; the server owns cursor advancement and returns typed
  progress, terminal state, and any capacity/fence failure.
- `backfillTranscriptRevisionOrder` is a resumable, idempotent migration with a
  server-owned cursor, explicit adapter order version, conflict counts, and no
  publication read switch side effect.
- `pausePublicationWorkers` advances a Brain/scope pause epoch. New claims fail
  closed, and leased workers compare the epoch again before activating a set.
- `switchBrainReadMode` compares the validated receipt tuple and high-waters
  described by BE3; `rollbackBrainReadMode` applies the correctness-safe
  compatibility rule below. Both return the previous/current mode and a typed
  rejection reason.

All operations use Confect specs with typed args, returns, and expected errors;
their focused contract is `test/brain-rollout-operations.test.ts`.

Rollback is a forward, schema-compatible operation with separate read-switch,
one-connector, and full-pilot scopes. Compatibility reads must enforce the
current lifecycle, cutoff, policy, connection, scope, allowlist, and
origin-integrity fences. If that equivalence cannot be proved, rollback disables
Ask Apero and restores the prior external workflow instead of returning legacy
evidence. Pausing publication fences new claims, and leased workers recheck the
pause epoch before activation. Preserve cursors, durable intents, raw ledgers,
and derived rows for diagnosis. Do not claim that deploying the pre-schema
binary is a rollback; current release tooling rejects schema/manifest hash
mismatches.

Each step runs focused gates and `just verify-full` (or the equivalent
`pnpm verify`), and uses a phase-scoped branch or PR derived from the current
default branch. The eventual combined staging tip runs the full gate again.
Every receipt records that exact SHA; a receipt from an earlier phase cannot
authorize the read switch. UI transplant work and Company Brain rollout work
remain reviewable as separate intentions even if temporarily stacked locally.

OAuth approval, provider sandbox access, source-owner review, or CRM custom
field mapping may dominate elapsed time. Each package should name an engineering
DRI, business DRI, external dependency, and maximum timebox before it starts.

## 9. Next Execution Actions

1. **Complete:** current retrieval capacity excludes classified retired
   postings, supports bounded pre-backfill rows, and fails visibly above the
   shared current-publication budget.
2. **Complete:** backend/docs and UI work are on clean, default-branch-derived
   branches, and the backend 99.7% type-coverage gate is restored without
   lowering the threshold.
3. Repair the UI branch's 264 web type errors independently.
4. Extract or feature-gate BE1/BE2/BE3 so projection reads cannot become the
   default before the operator backfill, validation, and same-SHA receipt.
5. Implement bounded eligibility fences so revocation fails closed immediately:
   a revoked page, route, policy, scope, or provider connection cannot remain
   readable when every async cleanup job is lost.
6. Add fenced provider reconciliation epochs for Slack and transcripts with
   scan, apply-removals, derived-drain, and complete phases; only a successful
   final close may report complete coverage.
7. Close the remaining WP02 integrity cases: derived-row cleanup before final
   origin purge, unresolved dead-letter preservation, all Slack target paths
   beyond one enumeration window, scoped health/freshness, origin validation in
   Search and ContextPack, superseded-versus-revoked citation reopening, public
   page-write conformance, fenced rebuild closure, correct pre-cap ranking,
   Slack cutoff enforcement, monotonic generations, and non-exact revision-only
   source lookup.
8. Add registered backfill/migration/pause operations and wire `/health` plus
   metrics to scoped backlog, freshness, capacity, and unresolved-failure data.
9. In parallel, inventory Ask Apero, capture E0, name owners/users, import the
   approved snapshot, and package the shared runtime skill without dogfood yet.
10. Prove compatibility-disabled Codex/Claude candidate-manifest parity and
    archive the exact runtime manifest and receipt.
11. Freeze the provider-specific Drive identity, cursor, membership, export, and
    tombstone rules; build the adapter against fixtures.
12. After WP02 and the full backend/integrated gates pass, exercise the
    one-container live Drive slice; begin dogfood only after the runtime and
    staging receipt packets pass.
13. Finish the canonical SaaS UI and its real health surface in the separate UI
    stream; it is a product completion gate, not a prerequisite for headless
    provider data to begin flowing through the phased backend rollout.

## 10. Required Cross-Corpus And Connector Tests

Implementation is not complete without explicit tests for:

- page, Slack, transcript, document, and structured publisher conformance;
- current-revision replacement and stale out-of-order delivery;
- delayed transcript v2 after v3 and tombstone/recreation ordering;
- tombstone, connection revocation, and route revocation;
- immediate read fencing after page, policy, route, scope, and connection
  revocation with every cleanup scheduler invocation suppressed;
- organization-wide connection rebuilds beyond one workspace-enumeration page;
- crash between raw-ledger commit and publication;
- crash before and after the atomic provider-page observation/seen-marker/cursor
  commit, proving that neither evidence nor inferred removals are skipped;
- lost scheduler/action delivery followed by recurring-sweeper recovery, durable
  retry, and visible failure;
- idempotent retry and full projection rebuild;
- policy-only and lifecycle-only republication with stable logical entry keys;
- more than one per-token query capacity of retired postings without starvation;
- partial reconciliation causing no deletion;
- live events newer than a reconciliation high-water mark surviving inferred
  removal, interrupted apply remaining partial, and completed reconciliation
  causing correct deletion;
- reconciliation run A closing after successor B and rebuild A closing after
  successor B, proving that the predecessor cannot infer removals, regress
  health, or report complete;
- old configuration run G1/R1 applying or closing after G2/R2, including when G2
  observes an unchanged idempotent revision without a new ledger sequence;
- deterministic ranking, stable tie-breaking, and byte-budget truncation;
- the true title/heading/freshness winner ranking above 40 otherwise-equal
  candidates regardless of insertion order;
- exact revision and segment citation resolution;
- exact `(publicationSetKey, entryKey)` citation reopen after a policy-only
  republication that retains the logical entry key;
- a displayed citation reopening exact superseded evidence after an ordinary
  edit while revoked/unshared evidence fails closed;
- origin-ledger hash/offset verification and corrupted-projection rejection;
- search and ContextPack integrity behavior when an immutable origin is missing
  or corrupted;
- every public page create, approve, update, archive, and restore surface
  producing the same durable publication or revocation contract;
- required corpus with no health row reported unavailable or unknown;
- reconciliation freshness based on source observation, not merely a recent
  rebuild timestamp, with health updates isolated to the affected scope;
- rebuild closure under concurrent insert, update, and archive activity;
- reconciliation and rebuild health remaining distinct, scoped, and pinned to
  their respective provider and ledger high-water marks;
- indexed, bounded provider-event replay detection;
- Slack publication enforcing the configured historical cutoff for rebuilds and
  delayed deliveries;
- advancing the Slack cutoff immediately fencing older evidence at read time;
- evidence freshness deriving from provider/source modification time rather than
  ingestion or rebuild time;
- publication generations remaining monotonic across revoke and restore;
- more than one revision-only lookup page of retired/ineligible matches before a
  current match, with deterministic pagination or typed overflow;
- dead-letter repair recording the failed effect it resolves;
- validation-versus-read-switch races where any advanced generation, watermark,
  or pending/due/unresolved effect rejects promotion;
- a required effect becoming claimed/leased/running between validation and the
  read-switch mutation, proving promotion rejects every nonterminal state;
- delete, unshare, and revoke followed by compatibility rollback, proving that
  legacy evidence cannot reappear;
- required scope deletion/deactivation remaining unavailable until an explicit
  decommission generation;
- WP02 reads with legacy compatibility explicitly disabled;
- cross-runtime candidate-manifest parity;
- coverage reporting when a required corpus or connector is unavailable.

Every focused Vitest command names an exact file. Because the package test
script permits zero tests, the named file must exist before the gate is treated
as evidence.

### WP02 Evidence Matrix

Keep this table current in every WP02 PR. “Implemented” means the named focused
test passes on the current backend branch; it does not authorize the read switch
until every required row and the clean-branch gates pass.

| Acceptance behavior                                                            | Exact evidence location                                                                                                  | Current status                                                                 |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Durable jobs, lost-schedule recovery, cursor continuation                      | `test/retrieval-publication.test.ts`, `test/retrieval-publication-crons.test.ts`                                         | Implemented                                                                    |
| Slack policy and accepted call-route target diffs                              | `test/channel-policies.test.ts`, `test/call-review.test.ts`, `confect/capabilities/routeCallToBrain.test.ts`             | Implemented                                                                    |
| Connection-generation fencing and rebuild enqueue                              | `test/transcript-connections.test.ts`, `test/retrieval-publication.test.ts`                                              | Implemented                                                                    |
| Delayed v2 after v3; equal-order conflict; tombstone/recreation                | `test/source-unit-ingestion.test.ts`                                                                                     | Implemented                                                                    |
| Public `(publicationSetKey, entryKey)` identity                                | `test/retrieval-publication.test.ts`, `confect/brain/readApi.spec.ts`                                                    | Implemented                                                                    |
| Origin-ledger hash/offset verification and corruption rejection                | `test/retrieval-publication.test.ts`                                                                                     | Current corpora implemented; document/projection resolvers await their ledgers |
| Derived-table cleanup before final-origin purge                                | `test/data-lifecycle.test.ts`, `test/data-lifecycle-ops.test.ts`                                                         | Required                                                                       |
| Successful-close-only provider coverage and inferred removals                  | `test/provider-reconciliation.test.ts`                                                                                   | Required                                                                       |
| Atomic provider-page cursor/observation/seen-marker commit                     | `test/provider-reconciliation.test.ts`                                                                                   | Required                                                                       |
| Reconciliation high-water fence, resumable removal apply, and derived drain    | `test/provider-reconciliation.test.ts`, `test/retrieval-publication-races.test.ts`                                       | Required                                                                       |
| Successor run authority blocks late reconciliation/rebuild close               | `test/provider-reconciliation.test.ts`, `test/retrieval-publication-races.test.ts`                                       | Required                                                                       |
| Scope tuple fence blocks old-generation run apply/close                        | `test/provider-reconciliation.test.ts`, `test/retrieval-publication-races.test.ts`                                       | Required                                                                       |
| Revocation immediately blocks reads and degrades health                        | `test/retrieval-publication-races.test.ts`, `test/brain-pilot.test.ts`, `test/headless-context.test.ts`                  | Required                                                                       |
| Successful rebuild preserves unresolved dead-letter health                     | `test/retrieval-publication.test.ts`, `test/brain-pilot.test.ts`                                                         | Required                                                                       |
| Health freshness and failures remain scoped to the affected corpus/connector   | `test/retrieval-publication.test.ts`, `test/headless-context.test.ts`                                                    | Required                                                                       |
| Missing expected corpus is unavailable/unknown                                 | `test/headless-context.test.ts`                                                                                          | Implemented                                                                    |
| Required scope intent survives deactivation until explicit decommission        | `test/headless-context.test.ts`, `test/provider-reconciliation.test.ts`                                                  | Required                                                                       |
| Organization rebuild beyond one enumeration page                               | `test/retrieval-publication.test.ts`                                                                                     | Implemented with explicit active-Brain capacity failure                        |
| Slack ingress and policy targets beyond one enumeration window                 | `test/channel-policies.test.ts`, `test/slack-ingress-runtime.test.ts`, `test/retrieval-publication-crons.test.ts`        | Implemented with durable capture, typed retry, sweeper, and complete resume    |
| Provider replay lookup is indexed and bounded                                  | `test/slack-ingress-runtime.test.ts`                                                                                     | Implemented                                                                    |
| Retired postings above capacity cannot starve current results                  | `test/brain-pilot.test.ts`                                                                                               | Implemented with legacy-state compatibility and typed overflow                 |
| Search and ContextPack reject copied text with a missing/corrupt origin        | `test/brain-pilot.test.ts`, `test/headless-context.test.ts`                                                              | Required                                                                       |
| Superseded citations reopen exact evidence; revoked citations fail closed      | `test/brain-pilot.test.ts`, `test/headless-context.test.ts`                                                              | Required                                                                       |
| Revision-only lookup paginates deterministically or returns typed overflow     | `test/brain-pilot.test.ts`, `test/headless-context.test.ts`                                                              | Required                                                                       |
| Every public page write surface uses the durable publication contract          | `test/page-publication-conformance.test.ts`                                                                              | Required                                                                       |
| Rebuild close is fenced against concurrent ledger changes                      | `test/retrieval-publication-races.test.ts`                                                                               | Required                                                                       |
| Full declared score is applied before the 40-candidate cap                     | `test/brain-pilot.test.ts`                                                                                               | Required                                                                       |
| Slack historical cutoff excludes rebuild and delayed pre-cutoff evidence       | `test/retrieval-publication.test.ts`, `test/channel-policies.test.ts`                                                    | Implemented                                                                    |
| Evidence freshness uses source modification time, not ingestion/rebuild time   | `test/retrieval-publication.test.ts`                                                                                     | Implemented                                                                    |
| Publication generation remains monotonic through revoke/restore                | `test/retrieval-publication.test.ts`                                                                                     | Required                                                                       |
| Terminal dead-letter repair is attributable and health reflects unresolved set | `test/retrieval-publication.test.ts`, `test/brain-pilot.test.ts`                                                         | Required                                                                       |
| Read switch CAS rejects stale receipt or unresolved required effects           | `test/brain-rollout-operations.test.ts`, `test/retrieval-publication-races.test.ts`                                      | Required                                                                       |
| Read switch CAS rejects claimed, leased, or running required effects           | `test/brain-rollout-operations.test.ts`, `test/retrieval-publication-races.test.ts`                                      | Required                                                                       |
| Rollback cannot resurrect deleted, unshared, or revoked legacy evidence        | `test/brain-rollout-operations.test.ts`, `test/headless-context.test.ts`                                                 | Required                                                                       |
| Registered backfill, transcript migration, pause, read switch, and rollback    | `test/brain-rollout-operations.test.ts`, `docs/superpowers/receipts/maestro-brain/staging-pilot-launch.md`               | Required                                                                       |
| Compatibility disabled and Codex/Claude manifest parity                        | `test/brain-pilot.test.ts`, `test/headless-context.test.ts`, `docs/superpowers/receipts/maestro-brain/runtime-parity.md` | Compatibility gate implemented; runtime parity receipt required                |

Each required row gains an engineering owner in its PR. Real-provider receipts
add the context owner and connector/access owner before WP03 or WP05 acceptance.

### Live Receipt Packet

Every staged snapshot, provider, runtime, dogfood, and rollout gate stores one
versioned receipt containing:

- exact commit SHA, environment, Brain key, connector/config version, and
  runtime manifest version;
- named engineering DRI and business/context approver;
- exact commands or workflow run IDs and timestamps;
- discovered, normalized, published, retired, failed, and stale counts;
- citation-open results and the relevant E0/E1 question-set version;
- create/edit/move-or-unshare/delete/reconcile/rebuild observations where the
  source supports them;
- rollback command or procedure and its observed result.

Receipts contain identifiers and aggregate evidence, not credentials or
sensitive source bodies. A local passing test is not a substitute for a live
receipt, and a receipt from a different commit does not authorize promotion.

## 11. Ready-To-Start Checklist

Start gates are track-specific:

**WP00-WP01 may begin now.** They require access to the decision and migration
packets only.

**Track A snapshot/dogfood requires:**

- access to the Claude Project instructions/files is available to the context
  owner;
- ten initial E0 questions are available;
- the context owner, engineer, and first two users are named;
- the snapshot is approved as reviewed Brain pages, not live synchronized data.
- WP02A-WP02C completion gates and `just verify-full` are green;
- the snapshot is retrievable through `brain.context.get`, not a legacy page
  compatibility read.

**WP02A-WP02C requires:**

- the engineering DRI is assigned before the first BE1 PR merges; local
  test-first implementation may begin now. The active agency Brain key is
  required for deployed backfill and acceptance receipts, not generic contract
  work;
- the engineer can run Convex/Confect codegen and focused backend tests;
- the retrieval publication projection, publication-subject,
  eligibility-generation, atomic cursor-commit, successor-run authority,
  expected-scope intent, promotion-CAS, and correctness-safe rollback contracts
  in WP02A-WP02C are accepted;
- ContextPack v1 uses the canonical `omissions` shape in the product spec;
- each phase PR names its exact files, engineering owner, planned focused test
  files, work-package classification, and template-backlog issue where required.

**WP05 requires:**

- WP02A-WP02C completion gates and the scoped rollout verification gate are
  green;
- one dedicated Drive test folder exists, a connector/access owner is named, and
  OAuth/provider setup has started.

Use these execution packets:

- [Apero Company Brain Pilot Decisions](./apero-company-brain-decisions.md)
- [Apero Company Brain Migration Matrix](./apero-company-brain-migration-matrix.md)

Unknown business names or credentials do not reopen architecture. They remain
visible checklist items owned by WP00-WP01.

## 12. Deferred Hardening Register

The following are intentionally deferred, not forgotten:

- per-document provider ACL enforcement;
- interactive delegated-user tokens and device binding;
- client/agency multi-Brain composition;
- organization-wide environment role bundles and drift enforcement;
- formal legal hold, residency, and backup-purge controls;
- general conflict-resolution queues;
- advanced semantic/vector retrieval;
- broad Gmail or signed-document ingestion;
- general-purpose write MCP or provider actions.

Promote an item only when pilot evidence, audience expansion, source
sensitivity, or a production requirement makes it necessary.
