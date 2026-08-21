# Apero Company Brain Data-First Implementation Plan

**Status:** reviewed execution plan; engineering may continue, but read switch,
deployment, and pilot remain blocked by the WP02 completion gates below

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

Commits through `02fe9c12` establish the first retrieval-publication vertical
slice. They provide current-publication identity, truthful freshness, durable
publication jobs, a registered one-minute recovery sweeper, bounded durable
page/Slack/transcript rebuild continuations, Slack-policy and accepted-call
target reconciliation, and provider-connection generation fencing. The worktree
is clean; formatting, lint, the Convex package typecheck, focused backend tests,
Confect contracts, and headless-surface contracts pass.

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

As of 2026-08-21, `just verify` passes formatting and lint, then fails at the
web package typecheck with the canonical SaaS UI transplant backlog. The mixed
branch is not merge-, deploy-, or pilot-ready. Backend work may continue behind
focused gates, but release requires a clean, default-branch-derived Brain PR and
a separately reviewable UI repair stream that both pass their full gates.

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

**Exit gate:** E0 can be run reproducibly and each question names the evidence
required to judge it.

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
```

Derive `passageKey` from the immutable origin revision, normalized UTF-8 byte
offsets, and passage content hash. Derive `entryKey` from workspace, Brain,
corpus, origin revision, passage key, and route generation. Rebuilds therefore
produce the same logical entry keys. Retrieval identity is the tuple
`(publicationSetKey, entryKey)`; `entryKey` alone is not sufficient because a
policy- or lifecycle-only republish may retain the same logical entry.

Each origin revision publishes through a `RetrievalPublicationSet` with a
monotonic publication generation and the state sequence
`building -> current -> retired | failed`. Entries and postings are built under
the inactive set, validated, then made current in the same transaction that
retires the previous set. Failed or partial builds never change the current
pointer.

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
publication job keyed by origin revision, Brain target, and route/lifecycle/
policy generations records attempts, success, terminal failure, and the effect
on corpus health. A one-shot scheduled function with a typed error return is not
a delivery guarantee. Register a recurring internal sweeper, name its interval
and deployment owner, and prove that a pending job converges when its initial
scheduler invocation never runs.

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

**Required tests:** current-revision replacement, delayed v2 after v3, duplicate
publication, lost initial scheduler delivery followed by automatic sweeper
recovery, scheduler/action failure followed by durable retry, policy-only and
lifecycle-only republish, route/target/connection revocation, tombstone and
purge, and complete rebuild equivalence for all three corpora, plus
existing-call rerouting and bounded Slack backfill.

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
- retrieve at most 40 candidates;
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
`(publicationSetKey, entryKey)`. Revocation makes the set non-current before it
becomes ineligible. Tests must prove that more than the per-token capacity of
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
revision-only lookup may enumerate current matches but may not claim exact
citation reopening. Citation keys include both publication and logical entry
identity.

Exact citation opening does not stop at `retrievalEntries`. It follows the
entry's discriminated origin to the immutable page, Slack, transcript, document,
or projection revision, reproduces the versioned normalization when necessary,
verifies passage offsets and content hash, and then returns the stable provider
locator. A missing or mismatched origin is a typed integrity failure. Add one
resolver and corruption test per origin variant.

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
the pilot critical path.

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

Use a generalized reconciliation run contract rather than extending the
transcript-only sync state:

```text
open generation -> enumerate every page -> mark every seen object
                -> close traversal successfully -> infer removals
```

A partial or failed traversal never infers deletion. Incremental cursors and
full-reconciliation generations are independent.

Add provider-neutral connector scope and reconciliation-run records containing
the organization, connection generation, provider/container key, allowlist
generation, incremental cursor, reconciliation generation, run status, start and
close timestamps, counts, and last error. Each observed provider object records
the last completed generation in which it was seen.

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

## 8. Recommended Delivery Sequence

Indicative ranges assume one primary engineer with timely business decisions:

| Track | Work                                                      | Indicative elapsed time |
| ----- | --------------------------------------------------------- | ----------------------- |
| A1    | WP00-WP01 inventory, decisions, and E0                    | 2-3 business days       |
| A2    | Review/import WP03 snapshot as unpublished Brain pages    | 1-2 business days       |
| A3    | WP04 skill work behind fixtures; dogfood waits for B3     | 2-3 engineering days    |
| B0    | Clean the worktree, restore full gates, split rollout PRs | 1-2 engineering days    |
| B1    | WP02A publication schema and agency route                 | 2-3 engineering days    |
| B2    | WP02B durable publishers, reconciliation, and rebuild     | 3-5 engineering days    |
| B3    | WP02C lexical retrieval, context, and surface convergence | 3-4 engineering days    |
| B4    | WP05 Drive walking skeleton                               | 3-5 engineering days    |
| B5    | WP06 Drive production coverage                            | 3-5 engineering days    |
| C     | WP07 structured source only when measured gaps justify it | 1-2 engineering weeks   |
| Pilot | WP08-WP09 dogfood closure and five-user pilot             | 2-3 calendar weeks      |

Inventory, evaluation capture, snapshot review, and skill packaging begin
immediately. Two-user dogfood begins only after B1-B3 pass; this avoids
launching on a legacy page-read path that would later be replaced. Drive adapter
unit work may overlap B2-B3 behind fixtures, but live ingestion begins only
after WP02 is green. Track C is conditional.

Use a merge train rather than one mixed rollout commit:

1. restore the branch gates and land additive schema/spec contracts;
2. land durable publishers plus one bounded backfill/rebuild per corpus;
3. verify counts, health, target-diff reconciliation, and lifecycle cleanup;
4. switch canonical reads and prove headless/runtime parity;
5. remove compatibility paths only after rollback and parity receipts pass.

Each step runs focused gates and `just verify`, and uses a phase-scoped branch
or PR derived from the current default branch. UI transplant work and Company
Brain rollout work must remain reviewable as separate intentions even if they
are temporarily stacked locally.

OAuth approval, provider sandbox access, source-owner review, or CRM custom
field mapping may dominate elapsed time. Each package should name an engineering
DRI, business DRI, external dependency, and maximum timebox before it starts.

## 9. First Ten Actions

1. Persist and enforce the transcript-provider ordering/fence contract,
   including delayed revisions and tombstone/recreation.
2. Carry `(publicationSetKey, entryKey)` through Search, ContextPack, citation
   keys, and exact source-get; resolve citations to the immutable origin and
   verify hash/offset integrity.
3. Add lifecycle cleanup, paginated organization target enumeration,
   successful-close-only reconciliation health, dead-letter health, and the
   expected-corpus manifest.
4. Gate legacy compatibility reads and prove WP02 with compatibility disabled.
5. Build a WP02 evidence matrix mapping every acceptance row to an exact test,
   integration receipt, owner, and status; close capacity and corruption cases.
6. Extract backend/docs work into phase-scoped, default-branch-derived PRs and
   regenerate contracts on the clean base.
7. Repair the canonical SaaS UI in a separate reviewable stream and restore the
   full-repository verification gate before merge/deploy/pilot.
8. In parallel, inventory Ask Apero, capture E0, name owners/users, import the
   approved snapshot, and package the shared runtime skill without dogfood yet.
9. Freeze the provider-specific Drive identity, cursor, membership, export, and
   tombstone rules; build the adapter against fixtures.
10. After WP02 backend gates pass, exercise the one-container live Drive slice;
    begin dogfood only after the runtime package and full release gates pass.

## 10. Required Cross-Corpus And Connector Tests

Implementation is not complete without explicit tests for:

- page, Slack, transcript, document, and structured publisher conformance;
- current-revision replacement and stale out-of-order delivery;
- delayed transcript v2 after v3 and tombstone/recreation ordering;
- tombstone, connection revocation, and route revocation;
- organization-wide connection rebuilds beyond one workspace-enumeration page;
- crash between raw-ledger commit and publication;
- lost scheduler/action delivery followed by recurring-sweeper recovery, durable
  retry, and visible failure;
- idempotent retry and full projection rebuild;
- policy-only and lifecycle-only republication with stable logical entry keys;
- more than one per-token query capacity of retired postings without starvation;
- partial reconciliation causing no deletion;
- completed reconciliation causing correct deletion;
- deterministic ranking, stable tie-breaking, and byte-budget truncation;
- exact revision and segment citation resolution;
- exact `(publicationSetKey, entryKey)` citation reopen after a policy-only
  republication that retains the logical entry key;
- origin-ledger hash/offset verification and corrupted-projection rejection;
- required corpus with no health row reported unavailable or unknown;
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

| Acceptance behavior                                                             | Exact evidence location                                                                                      | Current status |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | -------------- |
| Durable jobs, lost-schedule recovery, cursor continuation                       | `test/retrieval-publication.test.ts`, `test/retrieval-publication-crons.test.ts`                             | Implemented    |
| Slack policy and accepted call-route target diffs                               | `test/channel-policies.test.ts`, `test/call-review.test.ts`, `confect/capabilities/routeCallToBrain.test.ts` | Implemented    |
| Connection-generation fencing and rebuild enqueue                               | `test/transcript-connections.test.ts`, `test/retrieval-publication.test.ts`                                  | Implemented    |
| Delayed v2 after v3; equal-order conflict; tombstone/recreation                 | `test/source-unit-ingestion.test.ts`                                                                         | Implemented    |
| Public `(publicationSetKey, entryKey)` identity and policy-only citation reopen | `test/brain-pilot.test.ts`, `test/headless-context.test.ts`                                                  | Required       |
| Origin-ledger hash/offset verification and corruption rejection                 | `test/brain-pilot.test.ts`                                                                                   | Required       |
| Derived-table cleanup before final-origin purge                                 | `test/data-lifecycle.test.ts`, `test/data-lifecycle-ops.test.ts`                                             | Required       |
| Successful-close-only complete coverage and dead-letter health                  | `test/retrieval-publication.test.ts`, `test/brain-pilot.test.ts`                                             | Required       |
| Missing expected corpus is unavailable/unknown                                  | `test/headless-context.test.ts`                                                                              | Required       |
| Organization rebuild beyond one enumeration page                                | `test/retrieval-publication.test.ts`                                                                         | Required       |
| Retired postings above capacity cannot starve current results                   | `test/brain-pilot.test.ts`                                                                                   | Required       |
| Compatibility disabled and Codex/Claude manifest parity                         | `test/headless-context.test.ts` plus pinned runtime fixture receipt                                          | Required       |

Each required row gains an engineering owner in its PR. Real-provider receipts
add the context owner and connector/access owner before WP03 or WP05 acceptance.

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
- WP02A-WP02C completion gates and `just verify` are green;
- the snapshot is retrievable through `brain.context.get`, not a legacy page
  compatibility read.

**WP02A-WP02C requires:**

- the engineering DRI is known; the active agency Brain key is required for
  deployed backfill and acceptance receipts, not generic contract work;
- the engineer can run Convex/Confect codegen and focused backend tests;
- the retrieval publication projection decision in WP02A is accepted.

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
