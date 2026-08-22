# Apero Company Brain Data-First Implementation Plan

**Status:** local engineering execution-ready; merge and release execution
blocked. Continue the executable BE1 slices and fixture-backed WP00-WP02 work,
but do not merge the canonical read switch, deploy, or begin dogfood until the
named owner, phased rollout, obligation-closure, and completion gates below
pass.

**Date:** 2026-08-21

**Independent readiness review:** three uncorrelated delivery, adversarial
data-integrity, and systems/operations reviews completed on 2026-08-21. Verdict:
GO for continued local implementation; NO-GO for BE1 merge, shared dogfood, or
release until the stage-specific gates in this plan pass. This is an execution
sequence, not evidence that later slices are already implemented.

The acceptance target is deliberately split. WP00-WP09 deliver the **read
pilot**: provider evidence flows into one cited ContextPack used by Codex and
Claude Code, with no provider writes. WP07 adds a provider-backed structured
source when E0-E2 evidence justifies it. WP11 is a separate **CRM/action
slice**: a typed fact yields an opaque action reference, one agent-owned tool
request writes the provider through the capability gateway, and a durable
readback obligation proves the change flowed back through the immutable ledger.
Passing the read pilot never implies that CRM actions are complete.

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
11. Advance one Brain-scoped `projectionPopulationGeneration` transactionally on
    every mutation that can change a promotion predicate; validation must
    observe the same generation at the start and end, and promotion must compare
    it again atomically.
12. Keep `origin.kind = "projection"` publishers disabled for the pilot. They
    require a separately reviewed bounded transitive-provenance contract before
    derived evidence can become retrievable.

### Current Engineering Checkpoint

The current backend branch establishes the first retrieval-publication vertical
slice. It provides current-publication identity, truthful freshness, durable
publication-job retry, a registered one-minute recovery sweeper, bounded durable
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

- backend: `codex/company-brain-backend` at committed checkpoint `27347b08`;
- UI: `codex/canonical-saas-ui-clean` at `7bcb635e`.

The split is complete, but neither stream is release-ready. BE1-S1 at `1a5ed461`
passed the full gate with 1,688 coverage tests, 84.96% line coverage, and 99.71%
type coverage. BE1-S2A has passed its expanded 25-test focused suite and the
full backend gate with 817 Convex tests, 1,696 coverage tests, 85.02% line
coverage, and 99.71% type coverage at `d858b68e`. This is engineering evidence,
not a staging promotion receipt. BE1-S2B at `27347b08` passes its 110-test
focused controller/race suite and the full backend gate with 818 Convex tests,
1,697 coverage tests, 85.08% line coverage, and 99.71% type coverage. The UI
stream still passes lint and tests but, as rechecked on 2026-08-21, fails web
typecheck with exactly 264 errors from the incomplete template transplant. The
existing durable jobs prove recovery from lost scheduler delivery, but do not
yet persist and recheck the full subject-incarnation, scope, configuration,
eligibility, observation/reconciliation, and repair-attribution envelope. That
is required BE1 work, not completed evidence. The backend stack also combines
additive schema, publication workers, and callable projection reads; BE1-S3 must
make compatibility the default before BE1 can be deployed, so row presence
cannot switch reads before backfill and validation. Backend correctness work may
continue behind focused gates. Merge requires a green full gate for each phase,
and promotion requires a green integrated-tip gate and a receipt from the same
SHA.

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
  kind:
    "page" | "slack" | "transcript" | "document" | "structured" | "projection";
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
    | {
        kind: "structured";
        providerKey: string;
        connectionKey: string;
        connectorScopeKey: string;
        entityKind: string;
        providerEntityId: string;
        revisionKey: string;
        fieldPath: string;
        valueHash: string;
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

The publication-subject pointer selects the only candidate current set, and the
selected set must itself be `current`. Reads fail closed unless one canonical
integrity validator proves exactly one subject row for the derived subject key,
exactly one current set for that subject, pointer/set agreement, matching
organization/workspace/Brain/corpus/subject identity across set, entries, and
tokens, and matching expected row counts and manifest hash. Entry state and
token publication state are denormalized index aids; they cannot independently
authorize a read. The same validator is used by reads, backfill, rebuild close,
health, and BE3 promotion.

Immediate revocation uses bounded authoritative eligibility fences rather than
waiting for unbounded derived-row cleanup. Each publication records
`EligibilityFenceRef` values for the controlling page, Slack-artifact,
transcript-unit, and document-object lifecycle; Slack policy; call route;
connector scope; allowlist; and connection. The owning mutation advances the
relevant `eligibilityGeneration` in the same transaction as archive, route
rejection, policy removal, scope removal, or connection revocation. It advances
only on revoke or restore, never on ordinary content edits or
eligibility-preserving configuration changes. Search, ContextPack, and
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

`structured` is direct provider evidence: citation opening reopens the exact
immutable entity revision and hash-checks the typed field value. `projection` is
reserved for derived/transitive evidence and remains disabled for the read
pilot. A structured publication's exact eligibility manifest contains entity
lifecycle, connector scope, allowlist, connection, and field-mapping-policy
fences.

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
- `packages/convex/confect/tables/retrievalTokenCatalog.ts`
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

Every publish, retire, revoke, and cleanup effect rechecks its recorded subject
pointer, controlling configuration and eligibility generations, and a
non-reusable subject-incarnation epoch in the transaction that mutates derived
state. A delayed effect whose fence no longer matches becomes `superseded`; it
cannot retire a restored publication or change current health. Final origin
purge preserves a content-free subject/fence tombstone containing allocator and
incarnation history, so purge/recreate cannot reset publication generation or
make a pre-purge effect authoritative again.

Provider capture and publication-target resolution are separate durable effects.
Once an admitted event is normalized, routing ambiguity, fan-out capacity, or
downstream scheduling failure must not roll back its immutable receipt and
revision. The capture transaction commits the ledger plus one idempotent
target-resolution intent. A resumable worker resolves the complete target set,
records a typed capacity failure when necessary, and atomically creates all
publication jobs or none. Provider redelivery is never required for recovery.
Duplicate delivery while resolution is blocked creates neither a second revision
nor a second intent.

Every admitted provider object creates a scope-generation-qualified ingestion
obligation. The obligation advances through capture, normalization, target
resolution, publication-job creation, publication or explicit policy exclusion,
and any required removal and derived drain. Quarantine, retry-wait, capacity
block, pending/claimed/leased/running intent or job, and an unattributed
terminal failure are nonterminal for completeness even when no publication job
has yet been created. Reconciliation close, runtime health, and BE3 use this
same obligation predicate for every observation at or below the run high-water;
a closed traversal alone cannot report complete.

Introduce the provider-neutral reconciliation substrate in WP02 rather than
waiting for the Drive adapter: connector-scope records, incremental cursor
records, reconciliation runs, per-run seen markers, high-water fences, and
resumable phase cursors. Slack and transcripts are the first adapters; WP05
Drive reuses the same contract. Reconciliation state advances only through
`scan -> traversal_closed -> apply_removals -> drain_derived -> complete`.
Partial traversal never infers deletion, observations newer than the fence
survive removal inference, and only the final close plus zero unresolved
ingestion obligations at or below the run high-water makes the exact scope and
generation complete.

Provider and traversal cursors use compare-and-set against their expected
cursor, lease, and run generation. A fetched page advances its cursor only in
the same transaction that commits every observation, revision, membership or
seen marker, and target-resolution intent derived from that page. Fetch success
and downstream publication success never advance the cursor. If a provider page
cannot fit one transaction, first persist one immutable page envelope containing
the connector scope, authoritative run generation, expected and next cursors,
provider high-water, canonical page digest, total chunk count, and deterministic
digest for every chunk index. Every chunk receipt binds to that envelope. Lease
turnover may resume the same envelope, but a refetch with a different body,
high-water, next cursor, chunk count, or digest conflicts instead of mixing
receipts. The final cursor advance is conditional on every chunk in that exact
envelope being committed.

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
to discover them, but preserves the content-free subject/fence tombstone and
monotonic allocator described above; rebuild enumeration alone is not a purge
mechanism.

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

Maintain a bounded current-token integrity catalog keyed by Brain and token.
Atomic publication-set activation records the expected current posting count and
digest for every cataloged token; retirement removes that set from the same
catalog mutation. Query admission resolves the catalog before treating an empty
posting result as a healthy miss and compares the complete bounded posting
population to its expected count/digest. Missing or extra postings, a posting
whose entry is missing, or a catalog capacity overflow returns typed
`integrity_failure`, degrades the scope, and blocks promotion. Current pointed
sets are immutable; cleanup may mutate or delete them only after atomic pointer
retirement. Fault-injection tests delete the sole matching posting and the sole
matching entry and prove search/ContextPack never report an ordinary empty
result.

Eligibility evaluation is discriminated as `eligible`, legitimate `revoked`, or
`integrity_failure`; it is never collapsed to a silent boolean omission.
Missing, duplicate, excessive, wrong-controller, generation-mismatched, or
structurally incomplete manifests fail closed, produce a typed source-get error
and ContextPack omission, increment a scope-specific integrity metric, degrade
the affected required scope, and block BE3 while unresolved. A normal controller
revocation remains a revocation, not corruption. Post-promotion corruption tests
exercise both paths.

Add a `brainCorpusHealth` projection keyed by workspace, Brain, corpus, and
connector scope. It records coverage status, last successful observation,
publication and reconciliation times, expected freshness threshold, counts, and
degraded reason. Context coverage derives from these records, so zero search
results can be distinguished from unavailable or stale data. Reindexing old
evidence does not refresh its source-observation time. Only a successfully
closed complete reconciliation may set coverage to `complete`; failed or
interrupted runs remain partial/stale. Top-level ContextPack freshness is the
worst required-corpus state, never an unconditional `current` value.

ContextPack exposes temporal `freshness` separately from top-level
`coverageStatus` or `readiness`, which is the worst required-scope coverage and
ingestion-obligation state. A temporally fresh but partial connector, or a
freshly revoked required scope, never renders as healthy merely because its
timestamps are recent.

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

The mutation that activates or restores the owning policy, route, connection, or
scope atomically creates or advances its required-intent generation. An
owner-approved decommission compares and removes only the exact expected intent
and controlling configuration generation. A stale decommission from an earlier
generation cannot remove a restored requirement, and a crash cannot leave an
active required scope without durable intent.

Do not overload one timestamp or generation across four different facts. Keep
explicit records for:

1. the incremental provider cursor/checkpoint;
2. the provider reconciliation run and per-scope seen markers;
3. the projection rebuild run pinned to a ledger high-water mark;
4. publication delivery attempts, unresolved dead letters, and attributed
   repair.

`complete` requires a successfully closed reconciliation for the current
connection, scope, and allowlist generations plus zero unresolved ingestion
obligations at or below its high-water. This includes capture, normalization or
quarantine, target resolution, job creation, publication, removal, and derived
drain rather than only rows that reached the publication-job table. Projection
rebuild can prove ledger versus projection parity but cannot refresh provider
observation time or provider reconciliation coverage. The expected manifest and
ContextPack coverage output carry `connectorScopeKey`, the controlling
generation tuple, and whether the scope is required; aggregation by corpus name
alone is forbidden.

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
structured-entity, or projection revision, reproduces the versioned
normalization when necessary, verifies passage offsets and content hash, and
then returns the stable provider locator. A missing or mismatched origin is a
typed integrity failure. Add one resolver and corruption test per enabled pilot
origin variant. The projection variant returns typed unsupported until a
separate contract defines a bounded immutable input-evidence manifest,
dependency invalidation, cycle/depth/fan-in limits, and the rule that derived
authority cannot exceed its validated inputs.

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
- a durable `report wrong or stale` feedback path that records request ID,
  candidate-manifest hash, cited entry keys, readiness snapshot, category,
  disposition, and evaluation rerun linkage without copying source text;
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
- the context owner names a triage responder and response target before the
  first session.

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

The backend/UI handoff pins the generated Confect manifest version, backend
commit SHA, and ContextPack/health schema used by the UI branch. The backend
owner publishes generated refs and a sanitized pinned-response fixture; the UI
owner updates adapters and proves every typed backend state maps to a distinct
visible state. Integrate backend contracts first, rebase the UI stream onto that
contract tip, then run the combined full gate. A UI receipt from another backend
SHA is not product-completion evidence.

**Primary files:**

- `apps/web/src/features/brain/brain-surface.ts`
- `apps/web/src/features/brain/brain-surface.test.ts`
- `apps/web/src/features/brain/brain-workspace.tsx`
- `apps/web/src/features/brain/brain-workspace.test.tsx`
- `apps/web/src/features/health/health-surface.tsx`
- `apps/web/src/features/health/health-surface.test.ts`
- `apps/web/src/routes/_workspace.brain.tsx`
- `apps/web/src/routes/_workspace.health.tsx`

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

Before implementation, WP07-S0 freezes the structured-source contract:

- immutable provider observations and revisions with provider/entity/native ID,
  provider revision or version, independent observation order, and incarnation;
- lifecycle, tombstone/recreation, connector scope, and Brain routing;
- typed field path, normalized value and value hash, source-modified and
  observed timestamps, field authority, and provider locator;
- an origin resolver that reconstructs and hash-checks a cited typed value from
  the immutable revision rather than trusting copied projection fields;
- the bounded equality, set, and range filters, deterministic candidate order,
  typed ContextPack representation, and narrative/typed conflict behavior;
- an explicit rejection of unsupported joins or aggregations.

WP07 is delivered as three gated slices:

- **WP07-S0 — contract:** add `origin.kind = "structured"`, its immutable
  entity/field resolver, eligibility manifest, and a typed
  `brain.structured.query` contract. The query accepts a bounded conjunction of
  `{ entityKind, fieldPath, op: "eq" | "in" | "gte" | "lte", value }`, rejects
  unregistered field/operator pairs and joins, selects only declared indexes,
  and has deterministic ordering, cursor pagination, and typed capacity
  overflow. ContextPack v2 adds `structuredFacts` with entity reference, field
  path, typed value, immutable revision, value hash, authority, timestamps,
  locator, and optional future `actionRef`; its candidate-manifest hash covers
  those facts.
- **WP07-S1 — ingestion:** use the BE2 connector-scope, atomic page-envelope,
  cursor, observation-order, ingestion-obligation, required-intent, and closed
  reconciliation contracts. The approved CRM pipeline/view and object classes
  form the exact connector scope. Coverage cannot become complete before one
  successful full reconciliation and derived drain for the current scope tuple.
  This slice depends on BE2-S2 and BE2-S3.
- **WP07-S2 — publication:** publish direct structured origins, integrate typed
  facts into ContextPack, health, readiness, and the E2 receipt, and prove exact
  field-level citation opening in both runtimes. It may not use the disabled
  `projection` origin as a shortcut.

No WP07 publisher, E2 receipt, or production field mapping begins until this
contract has named schema/indexes, focused tests, and a context-owner approval.

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

Before the first action, ContextPack adds a versioned opaque `actionRef` that
contains, or resolves server-side to, provider, connection and scope,
entity-kind/native-ID, expected provider version, immutable revision, and
incarnation. It is independent of the display locator and does not itself grant
write authority.

An action accepts the stable provider entity reference and expected provider
revision/version carried by ContextPack. Immediately before preview and again
before execution, the capability gateway reads authoritative provider state and
rejects a stale precondition. It writes the provider system of record only; it
never patches the Brain projection or declares the result fresh. Confirmed,
failed, and ambiguous outcomes receive durable receipts. Every confirmed or
ambiguous outcome atomically creates a `postActionObservationObligation` linked
to the action receipt/idempotency key, initiating request and candidate-manifest
hash, action reference, entity/incarnation, expected pre-write version, provider
result identifier, reconciliation scope, and readback deadline. Only a later
immutable provider observation satisfying that obligation may advance the ledger
and republish ContextPack. A missed deadline degrades the structured scope and
schedules scoped reconciliation. Duplicate execution returns the original
action/readback receipt and never writes twice; connection or scope revocation
blocks both the action and its read-back.

WP11 is complete only when one CRM create/update workflow proves stale-action
rejection, one provider write under duplicate execution, durable readback after
both confirmed and ambiguous responses, lost-webhook convergence, refreshed
typed ContextPack/citation after the new immutable revision, and immediate
blocking after entity deletion, scope removal, or connection revocation.

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
Two-user dogfood begins only after capability tracks B1-B3 and rollout phase BE3
pass. Drive adapter unit work may overlap B2-B3 behind fixtures, but live
ingestion begins only after WP02 is green. Track C is conditional.

The two sequencing vocabularies are not interchangeable: B1/B2/B3 describe the
WP02A/WP02B/WP02C capability build, while BE1/BE2/BE3 describe expand,
backfill/observe, and promotion. Dogfood requires all WP02A-C evidence, BE3
projection promotion, compatibility-disabled runtime parity, and a green
integrated-tip gate from the same SHA; completing capability track B3 alone is
not authorization to start users.

Use this merge train rather than promoting the current combined backend stack:

1. **BE1 — expand:** additive schema, writers, eligibility fences,
   authority-envelope-bound durable jobs, and compatibility-preserving reads.
   Projection reads remain disabled.
2. **BE2 — backfill and observe:** registered operator operations start and
   resume subject, fence, page, Slack, and transcript projection backfills; an
   executable transcript-order migration and provider reconciliation run; live
   health proves complete ingestion obligations, freshness, capacity/integrity
   failures, and unresolved dead letters.
3. **BE3 — switch:** a per-Brain, schema-compatible read-mode record changes
   from `compatibility` to `projection` only through a compare-and-set mutation.
   The mutation must match the exact validated corpus/config/eligibility
   generation tuple and reconciliation/rebuild high-waters from a durable,
   expiring, same-SHA validation receipt, and reject when any relevant watermark
   advanced or any required ingestion obligation/effect is nonterminal or
   unresolved, explicitly including pending, retry-wait, capacity-blocked,
   quarantined, due, claimed, leased, or running work. The same receipt and
   mutation compare the subject- and fence-backfill generations/digests and
   require zero current or retained citation-addressable publication sets with
   missing/duplicate subject identity, pointer/cardinality corruption, or a
   missing, empty, duplicated, excessive, or incomplete required fence manifest.
   Validation and switching are never two unguarded steps.
4. **UI — independent:** finish the canonical SaaS UI and wire `/health` to the
   live backend contract. This remains required by the product goal, but the
   288-file transplant does not block the headless data pipeline from landing.
5. Remove compatibility code only after pilot acceptance and a separately
   rehearsed rollback window.

### BE1-S1 First Executable Slice — Stable Publication Subjects

**Classification:** `template-gap` (`CB-TG-01`)

**Status:** implemented and verified at backend commit `1a5ed461`. The focused
publication suite passes 17/17, and `just verify-full` passes with 809 Convex
tests, 1,688 coverage tests, 84.96% line coverage, and 99.71% type coverage.
This completes BE1-S1 only; it does not authorize the BE3 read switch.

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

### BE1-S2A Executable Slice — Page Lifecycle Eligibility Fence

**Classification:** `template-gap` (`CB-TG-01`)

**Status:** implemented and verified at backend commit `d858b68e`. The focused
publication suite passes 25/25, and `just verify-full` passes with 817 Convex
tests, 1,696 coverage tests, 85.02% line coverage, and 99.71% type coverage.
This slice proves the fence substrate and page lifecycle behavior only. Slack
and transcript source lifecycle, policy/route, and connection controllers follow
in BE1-S2B; scope and allowlist follow with BE2 scope records. Projection reads
remain disabled.

**Dependency:** BE1-S1 at `1a5ed461`.

**Intention:** add an authoritative, generation-fenced eligibility row whose
state changes in the same mutation as page archival. New page publications
capture the current lifecycle fence reference. Search and exact source-get fail
closed when a captured fence is missing, duplicated, over capacity, ineligible,
or generation-mismatched, even if a stale writer restores the old page row and
current revision after cleanup delivery is lost. Ordinary content edits and
eligibility-preserving republication do not advance eligibility generation.

**Tests first:** extend `packages/convex/test/retrieval-publication.test.ts`
with:

1. archive with all cleanup delivery suppressed while stale source state is
   restored, proving search and exact source-get remain closed;
2. deletion of a referenced fence, proving the current publication fails closed;
3. empty, duplicate-key, duplicate-kind, excessive, and generation-mismatched
   manifests, with a hard maximum of six captured fences;
4. duplicate authoritative rows for one fence key and a valid eligible fence
   belonging to a different page controller;
5. policy-only republication retaining the same eligible lifecycle generation;
6. current and retired publications remaining citation-reopenable after an
   ordinary edit while their captured lifecycle fence still matches.

**Implementation boundary:**

- `packages/convex/confect/tables/retrievalEligibilityFences.ts`
- `packages/convex/confect/tables/retrievalPublicationSets.ts`
- `packages/convex/confect/brain/retrievalEligibility.ts`
- `packages/convex/confect/brain/retrievalSchemas.ts`
- `packages/convex/confect/brain/retrievalPublication.ts`
- `packages/convex/confect/brain/retrievalPublication.impl.ts`
- `packages/convex/confect/brain/readApi.impl.ts`
- `packages/convex/confect/brain/pages.impl.ts`
- generated Confect schema/contracts
- `packages/convex/test/retrieval-publication.test.ts`
- `docs/product/maestro-brain-migrations.md`

The populated publication-set table keeps `eligibilityFences` optional during
BE1/BE2. New page publications always write a non-empty bounded manifest. Legacy
rows without manifests remain compatibility-readable only through the separate
compatibility path before the projection promotion gate; projection-mode reads
must reject them. BE2 must backfill the complete required manifest for every
current set and every retained retired set that remains citation-addressable,
then record one fence-backfill generation. It may never infer eligibility merely
from a cleanup outcome. BE3 verifies the same set population with the same
required-manifest validator used by reads before changing read mode.

**Gates and commit:**

```bash
pnpm confect:codegen
pnpm --dir packages/convex test test/retrieval-publication.test.ts
pnpm --dir packages/convex test test/retrieval-publication.test.ts test/brain-pages-crud.test.ts test/brain-pilot.test.ts test/headless-context.test.ts
pnpm --dir packages/convex typecheck
pnpm check:confect-contracts
pnpm check:schema-migration-notes
git diff --check
just verify-full
```

Commit only this intention as `fix: fence page retrieval eligibility`. BE1-S2B
then binds Slack/transcript object lifecycle, policy, route, and connection
controllers to the same substrate. Scope and allowlist arrive with the
provider-neutral BE2 records before backfill or BE3 promotion can complete.

### Required Eligibility Manifest Matrix

The six-fence limit is a contract, not an implementation default. Every origin
derives its exact required controller identities from immutable entry fields and
the current source configuration. Reads and BE3 promotion use the same
validator.

| Origin     | Required fence kinds                                                                         |
| ---------- | -------------------------------------------------------------------------------------------- |
| Page       | page `lifecycle`                                                                             |
| Slack      | source-artifact `lifecycle`, channel `policy`, and `connection`                              |
| Transcript | source-unit `lifecycle`, accepted `route`, and `connection`                                  |
| Document   | object `lifecycle`, connector `scope`, `allowlist`, and `connection`                         |
| Structured | entity `lifecycle`, connector `scope`, `allowlist`, `connection`, and field-mapping `policy` |
| Projection | producer `lifecycle` and `policy`, plus declared producer controllers                        |

An adapter may add a declared controller only while the total remains at or
below six. A valid manifest has exactly one reference for each required kind, no
undeclared kind, no duplicate kind or key, and an exact derived
`(organizationKey, kind, controllerKey, fenceKey, generation)` match. The
authoritative fence-key index must resolve to exactly one row. Missing,
duplicated, excessive, wrong-controller, generation-mismatched, or ineligible
state fails closed. A retained retired set uses the controller identities and
generations captured when it was published; ordinary supersession remains
citation-addressable, while a later revocation makes it unavailable.

### BE1-S2B Executable Slice — Existing Controller Fences

**Dependency:** BE1-S2A is committed and green.

**Status:** implemented and verified at backend commit `27347b08`. The ten
focused files pass 110/110, including the dedicated delayed-generation race, and
`just verify-full` passes with 818 Convex tests, 1,697 coverage tests, 85.08%
line coverage, and 99.71% type coverage. Projection reads remain disabled and
BE1-S2C is next.

**Intention:** bind the existing Slack source-artifact lifecycle and channel
policy, transcript source-unit lifecycle and accepted route, and both provider
connections to the fence substrate. Stable controller identities are
`slack-source:${organizationKey}:${sourceKey}`,
`slack-policy:${channelKey}:${brainKey}`,
`transcript-unit:${organizationKey}:${unitKey}`,
`transcript-route:${unitKey}:${brainKey}`, and `connection:${connectionKey}`.
Mutable configuration or content generations never appear in those controller
identities. Their owning mutations advance the eligibility generation only on
revoke/delete/redact or restore/recreation, in the same transaction as the
source/controller transition; ordinary content edits do not advance it. Newly
published Slack and transcript sets capture the exact three-fence manifest.
Scope and allowlist controllers land with the provider-neutral scope records in
BE2-S1B; they are not represented by invented placeholder rows.

**Tests first:** add lost-cleanup stale-writer cases for Slack tombstone,
transcript delete/redaction, policy removal, route rejection, and connection
revocation; wrong-controller and stale-generation manifests for each origin;
source recreation, route restore, and reconnect generation advancement; an
ordinary edit that retains the lifecycle eligibility generation; and a delayed
pre-recreation G1 publication effect attempting to activate after G2 restore.

**Primary files:**

- `packages/convex/confect/brain/retrievalEligibility.ts`
- `packages/convex/confect/brain/retrievalPublication.impl.ts`
- `packages/convex/confect/brain/readApi.impl.ts`
- `packages/convex/confect/slack/channelPolicies.impl.ts`
- `packages/convex/confect/slack/ingress.ts`
- `packages/convex/convex/slack/ingress.ts`
- `packages/convex/confect/sources/sourceSchemas.ts`
- `packages/convex/confect/capabilities/ingestSourceUnit.impl.ts`
- `packages/convex/confect/capabilities/routeCallToBrain.impl.ts`
- `packages/convex/confect/brain/callReview.impl.ts`
- `packages/convex/confect/integrations/slackConnections.impl.ts`
- `packages/convex/confect/integrations/slackDirectory.impl.ts`
- `packages/convex/confect/integrations/transcriptConnections.impl.ts`
- `packages/convex/confect/integrations/transcriptSync.impl.ts`
- `packages/convex/test/retrieval-publication-races.test.ts`
- `packages/convex/test/retrieval-publication.test.ts`
- `packages/convex/test/channel-policies.test.ts`
- `packages/convex/test/call-review.test.ts`
- `packages/convex/test/call-routing.test.ts`
- `packages/convex/test/source-unit-ingestion.test.ts`
- `packages/convex/test/slack-ingress-runtime.test.ts`
- `packages/convex/test/slack-directory.test.ts`
- `packages/convex/test/transcript-connections.test.ts`
- `packages/convex/test/transcript-sync.test.ts`

The dedicated race file must exist and prove the delayed pre-recreation G1
effect cannot activate after restore before this slice is complete. Run every
named exact test file together, Convex typecheck, Confect contracts, schema
migration notes, `git diff --check`, and `just verify-full`. Commit only this
intention as `fix: fence retrieval controllers`.

### BE1-S2C Executable Slice — Durable Effect Authority Envelope

**Dependency:** BE1-S2B is green.

**Intention:** expand every publication, retire, revoke, cleanup, target
resolution, and repair job so a delayed worker cannot act using one overloaded
generation. Persist the stable effect key, publication subject and incarnation,
connector scope, controlling configuration tuple, captured eligibility refs,
observation or reconciliation fence, target-resolution intent, and explicit
repair/supersession linkage. The worker compares the complete captured envelope
inside the transaction that activates/retires rows or changes health. A mismatch
becomes typed `superseded`; it never changes the restored subject or clears a
failure. The envelope is origin-discriminated: BE1 captures only controllers
that actually exist for that origin and never invents scope/allowlist
placeholders before BE2-S1B. Fields added to populated job tables remain
optional through BE1, and new writers populate them immediately. BE2-S1A
resumably migrates or supersedes every legacy nonterminal job before promotion.

Freeze an explicit `effectClass` and enforce this applicability/cardinality
matrix before implementation; optional storage for migration compatibility does
not mean optional runtime authority:

| Effect class                         | Subject/incarnation                                                                        | Observation/run linkage                                                                                                     | Target-resolution linkage                                                                              | Repair/supersession linkage                                                         |
| ------------------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| direct publish/retire/revoke/cleanup | exactly one                                                                                | exact immutable revision fence                                                                                              | required only for an ingress job created from all-or-none Slack target resolution; otherwise forbidden | forbidden                                                                           |
| target resolution                    | exact admitted receipt revision and source incarnation                                     | resolution attempt/configuration generation plus all-or-none target count/digest                                            | exactly one intent; every child has a backlink and terminal close proves no missing/extra child        | forbidden                                                                           |
| rebuild batch/continuation           | forbidden at batch level; each emitted child publication derives and validates exactly one | exactly one immutable rebuild run plus run generation, scope/config tuple, ledger high-water, cursor and predecessor digest | forbidden                                                                                              | forbidden                                                                           |
| attributed repair                    | same authority fields as the failed effect                                                 | same immutable revision or rebuild-run authority as the failed effect                                                       | inherited and revalidated when present on the failed effect                                            | exactly one `repairOfJobKey`; `supersedesJobKey` forbidden                          |
| migration replacement                | same authority fields as the replaced actionable job, or typed conflict                    | exact reconstructed fence/run authority                                                                                     | inherited and revalidated when applicable                                                              | exactly one `supersedesJobKey`; `repairOfJobKey` forbidden; old/new link atomically |

Connector scope is required exactly when that origin already has a real scope
controller and forbidden when it does not. Every present link is a real unique
foreign-key lookup, not a string copied back into its own digest. The worker
must resolve and prove organization/workspace/Brain/subject equality across the
target-intent -> obligation -> receipt -> immutable origin -> resolved target
chain. Repair must resolve the exact terminal failed effect and may clear only
that attributed failure. Missing, extra, cross-scope, cross-Brain, substituted,
or orphaned links are typed integrity failures and block execution/promotion.
Target resolution also rechecks policy, connection, organization/workspace, and
newer-attempt authority before closing; disappearance produces a typed stale or
zero-target result, never a guessed success. Resolution intent and child jobs
become terminal atomically only after the exact target population validates.

BE1-S2C also adds a minimal immutable `retrievalRebuildRuns` parent for existing
page/Slack/transcript rebuilds. Every continuation inherits, without
recapturing,
`{ rebuildRunKey, runGeneration, scope/configuration tuple, ledger high-water, pause epoch, cursor, predecessorDigest }`;
the child identity binds the predecessor and next cursor. Each batch compares
that tuple, successor-run authority, and high-water before emitting work. Final
close requires a complete set-difference/catch-up receipt and no nonterminal
child at or below the high-water. A predecessor or mixed-configuration run
cannot report complete health or satisfy promotion. BE2 may extend this record,
but cannot be the first place the authority exists.

**Tests first:** delayed publish/revoke/cleanup after restore and after
purge/recreation; changed route/policy/connection with the same legacy request
generation; repair of one terminal effect leaving unrelated dead letters
degraded; missing envelope fields rejected by projection validation; and lost
scheduler delivery still converging through the sweeper. Add link substitution,
cross-Brain/scope and orphan tests; repair without/wrong `repairOfJobKey`;
migration with missing or double supersession; configuration/route/connection
change between rebuild pages; successor run; replayed/substituted child;
concurrent insert behind the cursor; and stale predecessor final close.
Target-resolution tests cover policy/connection/workspace changes during delay,
a resolver older than a successor attempt, target-set substitution, legitimate
zero-target close after configuration disappearance, and missing/extra child
jobs before intent success.

**Primary files:**

- `packages/convex/confect/brain/retrievalPublicationJob.ts`
- `packages/convex/confect/tables/retrievalPublicationJobs.ts`
- `packages/convex/confect/tables/retrievalRebuildRuns.ts`
- `packages/convex/confect/brain/retrievalPublication.impl.ts`
- `packages/convex/confect/brain/retrievalPublication.ts`
- `packages/convex/convex/slack/ingress.ts`
- `packages/convex/test/retrieval-publication.test.ts`
- `packages/convex/test/retrieval-publication-races.test.ts`
- `packages/convex/test/retrieval-publication-crons.test.ts`
- `docs/product/maestro-brain-migrations.md`

Run Confect codegen when the table/spec changes, every named exact test file,
Convex typecheck, contracts, migration notes, `git diff --check`, and
`just verify-full`. Commit only this intention as
`fix: bind publication jobs to authority envelopes`.

Before close, inventory every `enqueueRetrievalPublicationJobEffect` call and
every raw `retrievalPublicationJobs` insert. Every new writer must populate the
complete origin-discriminated envelope in its owning transaction; the exact
writer list belongs in the PR receipt. The Slack target-resolution wrapper is in
scope because it inserts the all-or-none target jobs without a second mutation.

### BE1-S3 Executable Slice — Compatibility-Default Read Gate

**Dependency:** BE1-S2C is green.

**Intention:** make `compatibility` the schema-compatible default for every
Brain and define `disabled` as the correctness-safe emergency mode that returns
a typed unavailable result without consulting either evidence path. HTTP/MCP
search, source-get, and ContextPack may not enter projection mode merely because
projection rows exist. Add one per-Brain read-mode record; absence means
compatibility. Only the BE3 compare-and-set operation can select `projection`.
Pre-BE3 validation queries remain internal-only and cannot bypass the mode from
client input. The durable validation receipt and its schema first arrive in
BE3-S0.

**Tests first:** prove an absent mode record cannot expose projection rows, an
explicit compatibility read cannot expose them, `disabled` returns typed
unavailable, legacy compatibility cannot resurrect revoked evidence, and a stale
or directly patched promotion attempt is rejected.

**Primary files:** `packages/convex/confect/tables/brainReadModes.ts`, generated
schema, `packages/convex/confect/brain/readApi.spec.ts` and `.impl.ts`,
`packages/convex/confect/http.ts`,
`packages/convex/test/brain-rollout-operations.test.ts`,
`packages/convex/test/brain-pilot.test.ts`, and
`packages/convex/test/headless-context.test.ts`.

Run the three focused files, manifest/headless contracts, Convex typecheck,
schema migration notes, and `just verify-full`. Commit as
`fix: default brain reads to compatibility`. BE1 is not deployable before this
slice is green.

### BE2-S0 Executable Slice — Publication Subject Backfill And Integrity

**Dependency:** BE1-S3 is deployed with compatibility reads selected.

Backfill `publicationSubjectKey` and the subject allocator/current pointer for
every legacy current set/entry and every retained retired citation-addressable
set/entry. Derive subjects from immutable origin, Brain, corpus, route target,
and connector scope; never merge two scopes for one provider object. A
server-owned cursor and generation support restart and compare-and-set conflict
handling. Missing origins, ambiguous histories, collisions, duplicate subjects,
duplicate current sets, dangling pointers, pointers to retired sets, and
set/entry/token identity mismatches are counted as typed integrity failures,
degrade the affected scope, and prevent close rather than being guessed.

Run this through the registered `startProjectionBackfill` phase
`publication_subjects`. Pin a scan high-water and finish a bounded catch-up.
After all backfill writes finish, run a read-only, resumable validation/digest
pass over that pinned population. Capture the population generation before its
first page, require the same generation on every resumed page, and compare it
again in the close mutation; a change restarts only the validation pass. Return
a typed capacity/conflict result instead of using an unbounded scan or closing
over a mixed digest. Store the immutable legacy-population completion digest
separately from the live population version. Normal publish, retire, revoke,
manifest, required-intent, job, and obligation mutations advance the live
version; they do not invalidate or rewrite the historical migration receipt. BE3
computes current integrity against the live version instead of treating the
legacy digest as a mutable snapshot.

Successful close records a Brain-scoped subject-backfill generation plus a
population digest and proves one subject row, one matching current pointer/set,
monotonic allocator history, matching row counts, and manifest hash per logical
publication. Reads, rebuild close, health, and BE3 call the same canonical
publication-integrity validator. Retired history may be excluded only with an
explicit citation-invalidation receipt.

**Primary files:** `confect/tables/retrievalPublicationSubjects.ts`,
`confect/tables/brainProjectionPopulation.ts`, the publication-set/entry/token
tables, `confect/brain/retrievalPublication.impl.ts`,
`confect/brain/publicationIntegrity.ts`, the rollout-operations spec/impl, and
the two focused test files below.

Focused proof lives in `test/brain-rollout-operations.test.ts` and
`test/retrieval-publication-races.test.ts`, including interruption/restart,
two-scope identity, collision, duplicate current sets, dangling and retired
pointers, and concurrent publication. Run codegen/migration checks, both exact
files, Convex typecheck, contracts, `git diff --check`, and `just verify-full`.
Commit as `feat: backfill retrieval publication subjects`.

### BE2-S1A Executable Slice — Legacy Job Authority Migration

**Dependency:** BE2-S0 is complete with compatibility reads selected.

Register a resumable `migrateLegacyPublicationJobAuthority` operation with a
server-owned cursor, run generation, bounded batch size, typed conflict counts,
and immutable completion receipt. A legacy terminal-success job remains
historical. A nonterminal job missing authority fields is never guessed: derive
the exact current subject/controller envelope from immutable origin plus current
configuration, atomically create one replacement effect linked to the legacy
job, and mark the old job `superseded`; if derivation is ambiguous or the origin
is missing, leave it as a blocking integrity failure. Retry resumes the same
run, and concurrent job changes cause a compare-and-set conflict rather than a
mixed envelope. Promotion requires zero actionable legacy jobs without a
complete authority envelope.

**Primary files:** `packages/convex/confect/brain/retrievalPublicationJob.ts`,
`packages/convex/confect/tables/retrievalPublicationJobs.ts`,
`packages/convex/confect/brain/rolloutOperations.spec.ts` and `.impl.ts`,
`packages/convex/test/brain-rollout-operations.test.ts`,
`packages/convex/test/retrieval-publication-races.test.ts`, and migration notes.

Run Confect codegen, both exact tests, Convex typecheck, Confect contracts,
schema migration notes, `git diff --check`, and `just verify-full`. Commit only
this intention as `feat: migrate publication job authority`.

### BE2-S1B Executable Slice — Fence Backfill And Provider Scope Records

**Dependency:** BE2-S1A is complete with compatibility reads still selected.

Add the provider-neutral connector-scope and allowlist-generation records, then
make `startProjectionBackfill`/`resumeProjectionBackfill` expose an explicit
`eligibility_fences` phase. The server-owned cursor covers every current set and
every retained retired citation-addressable set. It validates origin integrity,
derives the exact manifest matrix above, writes by compare-and-set, records
current/retired/backfilled/invalidated/conflict counts, and advances the
Brain-scoped fence-backfill generation only after a complete zero-conflict
close. Restart resumes the same generation; a changed controller tuple
supersedes the run rather than mixing manifests. Historical retired sets may be
excluded only after an explicit citation-invalidation receipt.

Focused proof lives in `test/brain-rollout-operations.test.ts` and
`test/retrieval-publication-races.test.ts`; it includes interruption, restart,
concurrent retire, wrong-controller corruption, and a pre-S2A citation retired
immediately before backfill.

**Primary files:** `packages/convex/confect/tables/connectorScopes.ts`,
`packages/convex/confect/tables/connectorAllowlistGenerations.ts`,
`packages/convex/confect/tables/retrievalEligibilityFences.ts`, publication-set
tables, `packages/convex/confect/brain/rolloutOperations.spec.ts` and
`.impl.ts`, the shared manifest validator, and the two focused tests above. Run
Confect codegen, both exact tests, Convex typecheck, contracts, migration notes,
`git diff --check`, and `just verify-full`. Commit only this intention as
`feat: backfill retrieval fence manifests`.

### BE2-S1C Executable Slice — Transcript Observation-Order Migration

**Dependency:** BE2-S1B is green.

Implement registered `backfillTranscriptRevisionOrder` as a resumable,
idempotent migration with server-owned cursor, run generation, bounded batch
size, explicit adapter-order version, processed/backfilled/conflict/excluded
counts, and an immutable completion receipt. Derive order only from the frozen
provider-adapter contract. Equal-order/content conflicts, missing provider
versions, ambiguous tombstone/recreation history, and concurrent revision
changes remain typed blocking conflicts; they are never ordered by ingestion
time or revision-key novelty. Narrowing or projection validation requires zero
unresolved current/retained transcript-order conflicts.

**Primary files:** transcript revision/order schemas,
`packages/convex/confect/capabilities/ingestSourceUnit.impl.ts`,
`packages/convex/confect/brain/rolloutOperations.spec.ts` and `.impl.ts`,
`packages/convex/test/source-unit-ingestion.test.ts`,
`packages/convex/test/brain-rollout-operations.test.ts`, and migration notes.
Run codegen, both exact tests, Convex typecheck, contracts, migration notes,
`git diff --check`, and `just verify-full`. Commit only this intention as
`feat: backfill transcript observation order`.

### BE2-S1D Executable Slice — Operator Pause, Resume, And Scoped Repair

**Dependency:** BE2-S1C is green.

Implement registered, typed operations for pause, CAS-fenced resume, lease
drain/status, retry or attributed repair of one ingestion obligation or dead
letter, quarantine disposition with a durable reason, and generation-fenced
required-scope decommission. Pause advances a Brain/scope epoch; old leased
workers recheck it before activation. Resume compares the exact pause epoch and
cannot revive an old lease. Repair links to the failed effect and cannot clear
unrelated failures. Policy exclusion is only a durable, generation-fenced,
owner-approved decommission receipt; it is never a generic terminal state for a
failed obligation.

Focused proof lives in `test/brain-rollout-operations.test.ts` and
`test/retrieval-publication-races.test.ts`, including pause with an active
lease, stale resume, scoped repair, unrelated dead-letter preservation, and
stale decommission after restore. Commit as
`feat: operate brain publication recovery` after the standard codegen,
contracts, typecheck, migration, diff, and full gates pass.

**Primary files:** `packages/convex/confect/tables/brainPublicationPauses.ts`,
`packages/convex/confect/tables/brainOperationReceipts.ts`, ingestion-obligation
and required-intent tables,
`packages/convex/confect/brain/rolloutOperations.spec.ts` and `.impl.ts`,
publication worker claim/activation code,
`packages/convex/test/brain-rollout-operations.test.ts`, and
`packages/convex/test/retrieval-publication-races.test.ts`. Run Confect codegen,
both exact tests, Convex typecheck, contracts, migration notes,
`git diff --check`, and `just verify-full`; commit no other intention.

### BE2-S2A Executable Slice — Reconciliation Schema And Obligation Capture

**Dependency:** BE2-S1D is green.

Add connector-scope, incremental-cursor, immutable page-envelope/chunk,
reconciliation-run, seen-marker, required-scope-intent, and ingestion-obligation
records for Slack and transcripts. Capture an obligation atomically with each
admitted observation and required intent atomically with activation/restore.
Commit as `feat: capture provider ingestion obligations`.

### BE2-S2B Executable Slice — Atomic Provider Page Ingestion

**Dependency:** BE2-S2A is green.

Implement cursor/page-envelope/chunk CAS, deterministic page digests, provider
and ledger high-waters, and exact Slack/transcript adapters. A page cursor
advances only with every observation, seen marker, and obligation derived from
that page. Primary files are the cursor/page-envelope/page-chunk/seen and
obligation tables, `confect/integrations/providerReconciliation.spec.ts` and
`.impl.ts`, `confect/integrations/slackReconciliationAdapter.ts`,
`confect/integrations/transcriptReconciliationAdapter.ts`, and the two focused
tests below. Commit as `feat: ingest reconciled provider pages`.

### BE2-S2C Executable Slice — Reconciliation Removal And Drain

**Dependency:** BE2-S2B is green.

Implement `scan -> traversal_closed -> apply_removals -> drain_derived` with
scope-tuple and successor-run authority plus resumable removal/drain cursors.
Partial or predecessor runs cannot infer removals or change current health.
Primary files are the reconciliation-run/seen records,
`providerReconciliation.spec.ts` and `.impl.ts`, both source adapters,
retrieval-publication retirement/drain code, and the two focused tests below.
Commit as `feat: reconcile provider removals`.

### BE2-S2D Executable Slice — Obligation Closure And Required Intent

**Dependency:** BE2-S2C is green.

Implement final `complete`. It uses the shared obligation predicate and rejects
quarantine, capacity-blocked resolution, nonterminal intents/jobs, unresolved
failures, or removal/drain backlog at or below the run high-water. Required
intent survives deactivation until the explicit generation-fenced decommission
operation from BE2-S1D. Primary files are the required-intent/obligation and
reconciliation-run tables, `providerReconciliation.spec.ts` and `.impl.ts`,
rollout-status predicate helpers, both source adapters, and the two focused
tests below. Commit as `feat: close provider ingestion obligations`.

Each BE2-S2 slice updates `test/provider-reconciliation.test.ts` plus
`test/retrieval-publication-races.test.ts`, covering crash boundaries, late
predecessor close, old scope tuple, unchanged observations in a new tuple,
partial traversal, live events beyond the high-water, and every nonterminal
obligation class. Each slice runs both exact tests, Confect codegen, Convex
typecheck, contracts, migration notes, `git diff --check`, and
`just verify-full`. A source-specific file may be added only after the PR names
it; transaction ownership and its gate cannot be deferred to a later slice.

**Primary files:** `confect/tables/connectorScopes.ts`,
`connectorIncrementalCursors.ts`, `connectorPageEnvelopes.ts`,
`connectorPageChunks.ts`, `connectorReconciliationRuns.ts`,
`connectorReconciliationSeen.ts`, `brainRequiredScopeIntents.ts`, and
`ingestionObligations.ts`; `confect/integrations/providerReconciliation.spec.ts`
and `.impl.ts`; `confect/integrations/slackReconciliationAdapter.ts`;
`confect/integrations/transcriptReconciliationAdapter.ts`; and the two focused
tests above.

### BE2-S3 Executable Slice — Scoped Health And Rollout Status

**Dependency:** BE2-S2A through BE2-S2D are green.

Add one typed operator/read contract for Brain rollout status. It returns each
required corpus and scope with its configuration tuple, reconciliation and
rebuild high-waters, subject/fence backfill generations and digests, temporal
freshness, coverage/readiness, obligation counts by state, capacity failures,
publication-integrity failures, eligibility-integrity failures, and attributed
dead letters. Define promotion predicates mechanically: every required scope is
within its WP01 freshness threshold and complete for the current tuple, all
subject/fence populations validate, every required obligation is terminal
success or explicit policy exclusion, and zero hidden capacity/integrity or
unresolved failure remains.

Evaluate the WP01 per-scope SLOs mechanically and alert the named DRI on a
freshness/reconciliation breach, oldest-obligation breach, dead letter,
quarantine, stalled cursor, integrity failure, or retrieval-capacity overflow.
Alert payloads contain identifiers, generations, counts, and a runbook link,
never source bodies. Focused proof fires and clears each alert. A CLI/status
surface backed by this contract is required before two-user headless dogfood;
the canonical UI is required before the five-user shared pilot.

Update the product specification and generated ContextPack contract in this
slice with a version bump that adds top-level temporal `freshness` and separate
`coverageStatus`/`readiness`; do not claim these fields in behavior while the v1
schema omits them. Older clients remain on the compatibility contract until
their manifest supports the new version.

Focused proof lives in `test/brain-rollout-operations.test.ts`,
`test/brain-pilot.test.ts`, and `test/headless-context.test.ts`. It includes
fresh-but-partial, freshly revoked required scope, silent manifest corruption,
missing health row, unrelated repair, and scoped failure isolation. Commit as
`feat: expose brain rollout readiness` after contracts, headless manifest,
typecheck, full verification, and migration gates pass.

**Primary files:** `docs/product/apero-company-brain-spec.md`, the ContextPack
schema/manifest, `confect/tables/brainCorpusHealth.ts`,
`confect/brain/rolloutStatus.spec.ts`, `rolloutStatus.impl.ts`,
`confect/brain/readApi.impl.ts`, the ContextPack schemas, and the three focused
tests above.

### BE3-S0 Executable Slice — Durable Projection Validation Receipt

**Dependency:** BE2-S3 and every required WP02 evidence row are green.

Implement registered `validateBrainProjectionReadiness` semantics. The operation
reruns the shared publication, eligibility-manifest, obligation, expected-scope,
health, and job-state validators and writes an immutable, single-Brain receipt
bound to deployment SHA/schema/manifest, configuration generations,
reconciliation/rebuild high-waters, subject/fence backfill generations and
population digests, required-intent generation, job/obligation counts, and a
30-minute expiry. Deployment SHA, schema version, and manifest version come from
server build metadata, never client arguments. Validation captures the same
`projectionPopulationGeneration` before and after its bounded scan; any change
aborts the receipt. The receipt is server-created, cannot be supplied or patched
by a client, is single-use for promotion, and becomes stale when any bound value
advances.

Focused tests in `test/brain-rollout-operations.test.ts` and
`test/retrieval-publication-races.test.ts` cover cross-Brain use, replay,
tampering, expiry, advancing watermarks, new retained history, and work changing
state between validation and promotion. Add races for publish, retire, revoke,
retained-history change, manifest mutation, required-intent change, and every
job/obligation transition. Commit as
`feat: validate brain projection readiness`.

**Primary files:** `confect/tables/brainProjectionValidationReceipts.ts`,
`confect/brain/rolloutOperations.spec.ts`, `rolloutOperations.impl.ts`, the
shared validators, and the two focused tests above.

### BE3-S1 Executable Slice — Receipt-Bound Projection Promotion

**Dependency:** BE3-S0 produced an unexpired receipt for the exact current SHA
and Brain.

Implement `switchBrainReadMode` as the only compatibility-to-projection path. In
one mutation it consumes the receipt and compares the exact validated
corpus/config, subject/fence-backfill generation and digest tuple,
reconciliation and rebuild high-waters, required-scope manifest, complete
ingestion-obligation population, and zero nonterminal or unresolved effects. It
reruns the shared publication-integrity and required-manifest validators over
the receipt population, compares the live `projectionPopulationGeneration`, and
changes the mode only if nothing advanced. Focused tests force every
compare-and-set race, including a current set retiring and a retained citation
set appearing between validation and switch. Commit as
`feat: promote validated brain projection`.

**Primary files:** `packages/convex/confect/tables/brainReadModes.ts`,
`packages/convex/confect/tables/brainProjectionValidationReceipts.ts`,
`packages/convex/confect/brain/rolloutOperations.spec.ts` and `.impl.ts`, shared
publication/manifest/obligation validators,
`packages/convex/test/brain-rollout-operations.test.ts`, and
`packages/convex/test/retrieval-publication-races.test.ts`. Run both exact
tests, manifest/headless contracts, Convex typecheck, migration notes,
`git diff --check`, and `just verify-full`; commit no other intention.

BE2 must expose documented, registered operations equivalent to
`startProjectionBackfill`, `resumeProjectionBackfill`,
`migrateLegacyPublicationJobAuthority`, `backfillTranscriptRevisionOrder`,
`pausePublicationWorkers`, `resumePublicationWorkers`, lease-drain/status,
scoped obligation/dead-letter repair, quarantine disposition, required-scope
decommission, and `getBrainRolloutStatus`; BE3 adds
`validateBrainProjectionReadiness`. Names may follow repository conventions, but
operators may not be required to call test helpers or manually invent cursor
loops.

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
- `migrateLegacyPublicationJobAuthority` resumably supersedes actionable legacy
  jobs with exactly linked authority-envelope jobs or reports typed conflicts;
  it never fabricates missing controller generations.
- `pausePublicationWorkers` advances a Brain/scope pause epoch. New claims fail
  closed, and leased workers compare the epoch again before activating a set.
- `resumePublicationWorkers` compares the exact pause epoch and current lease
  state; it cannot make an old claimant authoritative.
- repair/decommission operations are idempotent, scoped, dry-run capable, and
  emit immutable receipts linked to the exact failed effect or required intent.
- `getBrainRolloutStatus` returns the exact machine-checkable scoped readiness
  and blocking predicates defined by BE2-S3; operators do not reconstruct them
  from logs.
- `validateBrainProjectionReadiness` persists the immutable, expiring,
  single-use BE3-S0 receipt and never accepts client-supplied validation facts.
- `switchBrainReadMode` compares the validated receipt tuple and high-waters
  described by BE3; `rollbackBrainReadMode` applies the correctness-safe
  compatibility rule below. Both return the previous/current mode and a typed
  rejection reason.

All operations use Confect specs with typed args, returns, and expected errors;
their focused contract is `test/brain-rollout-operations.test.ts`.

Rollback is a forward, schema-compatible operation with separate read-switch,
one-connector, and full-pilot scopes. Compatibility reads must enforce the
current lifecycle, cutoff, policy, connection, scope, allowlist, and
origin-integrity fences. If that equivalence cannot be proved,
`rollbackBrainReadMode` selects the explicit `disabled` mode, Ask Apero returns
typed unavailable, and the runtime manifest restores the prior external workflow
instead of returning legacy evidence. Pausing publication fences new claims, and
leased workers recheck the pause epoch before activation. Preserve cursors,
durable intents, raw ledgers, and derived rows for diagnosis. Do not claim that
deploying the pre-schema binary is a rollback; current release tooling rejects
schema/manifest hash mismatches.

Publish and rehearse the read-switch rollback before BE3 promotion, the
one-connector rollback before the first live WP05 run, and the full-pilot
rollback before WP09. Each ordered runbook names pause and lease-drain checks,
the rollout-status query and success predicates, compatibility-equivalence
validation, endpoint/skill disable behavior when compatibility is unsafe,
recovery and re-enable steps, and the exact receipt location. A prose promise to
roll back is not a passing rehearsal.

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
3. Name the engineering DRI before the first BE1 merge; local test-first work
   may continue while that business assignment is completed.
4. **Complete:** BE1-S2B makes Slack/transcript object lifecycle, route, policy,
   and provider-connection revocation fail closed when every async cleanup job
   is lost, and stale G1 publication cannot activate after restore.
5. Land BE1-S2C so every durable effect carries and transactionally rechecks its
   complete authority envelope.
6. Land BE1-S3 so compatibility is the default and projection reads cannot
   become active before operator backfill, validation, and the same-SHA receipt.
7. Run BE2-S0 and BE2-S1A-C subject, legacy-job, fence, and transcript-order
   migrations, then BE2-S2A-D/S3 reconciliation-obligation closure and
   machine-checkable scoped health.
8. Close the remaining WP02 integrity cases: derived-row cleanup before final
   origin purge, unresolved dead-letter preservation, all Slack target paths
   beyond one enumeration window, scoped health/freshness, origin validation in
   Search and ContextPack, superseded-versus-revoked citation reopening, public
   page-write conformance, fenced rebuild closure, correct pre-cap ranking,
   Slack cutoff enforcement, monotonic generations, and non-exact revision-only
   source lookup.
9. Add the registered backfill, migration, pause, rollout-status, validation,
   switch, and rollback operations; complete BE3 only from its durable receipt.
10. In parallel, repair the UI branch's 264 web type errors, inventory Ask
    Apero, capture E0, name owners/users, import the approved snapshot, and
    package the shared runtime skill without dogfood yet.
11. Prove compatibility-disabled Codex/Claude candidate-manifest parity and
    archive the exact runtime manifest and receipt.
12. Freeze the provider-specific Drive identity, cursor, membership, export, and
    tombstone rules; build the adapter against fixtures.
13. After WP02 and the full backend/integrated gates pass, exercise the
    one-container live Drive slice; begin dogfood only after the runtime and
    staging receipt packets pass.
14. Finish the canonical SaaS UI and its real health surface in the separate UI
    stream; it is a product completion gate, not a prerequisite for headless
    provider data to begin flowing through the phased backend rollout.

## 10. Required Cross-Corpus And Connector Tests

Implementation is not complete without explicit tests for:

- page, Slack, transcript, document, and structured publisher conformance;
- current-revision replacement and stale out-of-order delivery;
- delayed transcript v2 after v3 and tombstone/recreation ordering;
- tombstone, connection revocation, and route revocation;
- immediate read fencing after page, Slack-artifact, transcript-unit, policy,
  route, scope, and connection revocation with every cleanup scheduler
  invocation suppressed;
- organization-wide connection rebuilds beyond one workspace-enumeration page;
- crash between raw-ledger commit and publication;
- admitted evidence blocked in normalization/quarantine or target resolution,
  proving reconciliation cannot report complete before the full ingestion
  obligation becomes terminal;
- crash before and after the atomic provider-page observation/seen-marker/cursor
  commit, proving that neither evidence nor inferred removals are skipped;
- lost scheduler/action delivery followed by recurring-sweeper recovery, durable
  retry, and visible failure;
- idempotent retry and full projection rebuild;
- duplicate current sets, dangling or retired subject pointers, mismatched
  set/entry/token identity, and row-count/manifest-hash corruption failing
  closed and degrading the affected scope;
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
- a temporally fresh but partial connector and a freshly revoked required scope
  reporting non-ready coverage independently from freshness;
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
- a delayed revoke/cleanup effect from generation G1 executing after restore G2,
  proving it becomes superseded without retiring G2 or changing health;
- final purge followed by recreation plus replay of a pre-purge effect, proving
  the content-free subject tombstone preserves allocator/incarnation fencing;
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
- atomic required-intent creation at activation/restore and stale G1
  decommission after G2 restore, including the activation crash boundary;
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

| Acceptance behavior                                                                                       | Exact evidence location                                                                                                                                | Current status                                                                 |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------ |
| Lost-schedule recovery and cursor continuation                                                            | `test/retrieval-publication.test.ts`, `test/retrieval-publication-crons.test.ts`                                                                       | Implemented                                                                    |
| Durable effects capture and recheck the complete authority envelope                                       | `test/retrieval-publication.test.ts`, `test/retrieval-publication-races.test.ts`                                                                       | Required in BE1-S2C                                                            |
| Legacy nonterminal jobs are migrated or explicitly superseded                                             | `test/brain-rollout-operations.test.ts`, `test/retrieval-publication-races.test.ts`                                                                    | Required in BE2-S1A                                                            |
| Slack policy and accepted call-route target diffs                                                         | `test/channel-policies.test.ts`, `test/call-review.test.ts`, `confect/capabilities/routeCallToBrain.test.ts`                                           | Implemented                                                                    |
| Connection-generation fencing and rebuild enqueue                                                         | `test/transcript-connections.test.ts`, `test/retrieval-publication.test.ts`                                                                            | Implemented                                                                    |
| Delayed v2 after v3; equal-order conflict; tombstone/recreation                                           | `test/source-unit-ingestion.test.ts`                                                                                                                   | Implemented                                                                    |
| Legacy transcript observation order is migrated with zero unresolved conflict                             | `test/source-unit-ingestion.test.ts`, `test/brain-rollout-operations.test.ts`                                                                          | Implemented in BE2-S1C                                                         |
| Public `(publicationSetKey, entryKey)` identity                                                           | `test/retrieval-publication.test.ts`, `confect/brain/readApi.spec.ts`                                                                                  | Implemented                                                                    |
| Origin-ledger hash/offset verification and corruption rejection                                           | `test/retrieval-publication.test.ts`                                                                                                                   | Current corpora implemented; document/projection resolvers await their ledgers |
| Page lifecycle fence rejects lost cleanup, corrupt manifests, and wrong controller                        | `test/retrieval-publication.test.ts`                                                                                                                   | Implemented in BE1-S2A                                                         |
| Slack/transcript lifecycle, policy/route, and connection fences reject lost cleanup                       | `test/retrieval-publication-races.test.ts`, `test/slack-ingress-runtime.test.ts`, `test/source-unit-ingestion.test.ts`                                 | Implemented in BE1-S2B                                                         |
| Legacy current/retained sets have one valid subject, pointer, and allocator                               | `test/brain-rollout-operations.test.ts`, `test/retrieval-publication-races.test.ts`                                                                    | Required in BE2-S0                                                             |
| Current and retained retired sets receive complete required fence manifests                               | `test/brain-rollout-operations.test.ts`, `test/retrieval-publication-races.test.ts`                                                                    | Required                                                                       |
| Publication pointer/cardinality and set/entry/token integrity fail closed                                 | `test/brain-rollout-operations.test.ts`, `test/retrieval-publication-races.test.ts`                                                                    | Required in BE2-S0                                                             |
| Live projection population generation fences validation and promotion races                               | `test/brain-rollout-operations.test.ts`, `test/retrieval-publication-races.test.ts`                                                                    | Required in BE2-S0 and BE3                                                     |
| Derived-table cleanup before final-origin purge                                                           | `test/data-lifecycle.test.ts`, `test/data-lifecycle-ops.test.ts`                                                                                       | Required                                                                       |
| Stale effects cannot revoke a restored/recreated subject after purge                                      | `test/retrieval-publication-races.test.ts`, `test/data-lifecycle.test.ts`                                                                              | Required                                                                       |
| Successful-close-only provider coverage and inferred removals                                             | `test/provider-reconciliation.test.ts`                                                                                                                 | Required                                                                       |
| Completeness covers normalization, resolution, jobs, publication, and drain                               | `test/provider-reconciliation.test.ts`, `test/retrieval-publication-races.test.ts`                                                                     | Required in BE2-S2A-D                                                          |
| Atomic provider-page cursor/observation/seen-marker commit                                                | `test/provider-reconciliation.test.ts`                                                                                                                 | Required                                                                       |
| Reconciliation high-water fence, resumable removal apply, and derived drain                               | `test/provider-reconciliation.test.ts`, `test/retrieval-publication-races.test.ts`                                                                     | Required                                                                       |
| Successor run authority blocks late reconciliation/rebuild close                                          | `test/provider-reconciliation.test.ts`, `test/retrieval-publication-races.test.ts`                                                                     | Required                                                                       |
| Scope tuple fence blocks old-generation run apply/close                                                   | `test/provider-reconciliation.test.ts`, `test/retrieval-publication-races.test.ts`                                                                     | Required                                                                       |
| Revocation immediately blocks reads and degrades health                                                   | `test/retrieval-publication-races.test.ts`, `test/brain-pilot.test.ts`, `test/headless-context.test.ts`                                                | Required                                                                       |
| Successful rebuild preserves unresolved dead-letter health                                                | `test/retrieval-publication.test.ts`, `test/brain-pilot.test.ts`                                                                                       | Required                                                                       |
| Health freshness and failures remain scoped to the affected corpus/connector                              | `test/retrieval-publication.test.ts`, `test/headless-context.test.ts`                                                                                  | Required                                                                       |
| Freshness is separate from required-scope coverage/readiness                                              | `test/brain-pilot.test.ts`, `test/headless-context.test.ts`                                                                                            | Required in BE2-S3                                                             |
| Eligibility corruption is typed, degrades health, and blocks promotion                                    | `test/retrieval-publication-races.test.ts`, `test/headless-context.test.ts`                                                                            | Required in BE2-S3                                                             |
| Missing expected corpus is unavailable/unknown                                                            | `test/headless-context.test.ts`                                                                                                                        | Implemented                                                                    |
| Required scope intent survives deactivation until explicit decommission                                   | `test/headless-context.test.ts`, `test/provider-reconciliation.test.ts`                                                                                | Required                                                                       |
| Required-intent activation/restore is atomic and stale decommission is fenced                             | `test/headless-context.test.ts`, `test/provider-reconciliation.test.ts`                                                                                | Required                                                                       |
| Organization rebuild beyond one enumeration page                                                          | `test/retrieval-publication.test.ts`                                                                                                                   | Implemented with explicit active-Brain capacity failure                        |
| Slack ingress and policy targets beyond one enumeration window                                            | `test/channel-policies.test.ts`, `test/slack-ingress-runtime.test.ts`, `test/retrieval-publication-crons.test.ts`                                      | Implemented with durable capture, typed retry, sweeper, and complete resume    |
| Provider replay lookup is indexed and bounded                                                             | `test/slack-ingress-runtime.test.ts`                                                                                                                   | Implemented                                                                    |
| Retired postings above capacity cannot starve current results                                             | `test/brain-pilot.test.ts`                                                                                                                             | Implemented with legacy-state compatibility and typed overflow                 |
| Search and ContextPack reject copied text with a missing/corrupt origin                                   | `test/brain-pilot.test.ts`, `test/headless-context.test.ts`                                                                                            | Required                                                                       |
| Missing sole matching posting/entry is integrity failure, not healthy empty                               | `test/brain-pilot.test.ts`, `test/headless-context.test.ts`, `test/retrieval-publication-races.test.ts`                                                | Required in WP02C and BE2-S0                                                   |
| Superseded citations reopen exact evidence; revoked citations fail closed                                 | `test/brain-pilot.test.ts`, `test/headless-context.test.ts`                                                                                            | Required                                                                       |
| Revision-only lookup paginates deterministically or returns typed overflow                                | `test/brain-pilot.test.ts`, `test/headless-context.test.ts`                                                                                            | Required                                                                       |
| Every public page write surface uses the durable publication contract                                     | `test/page-publication-conformance.test.ts`                                                                                                            | Required                                                                       |
| Rebuild close is fenced against concurrent ledger changes                                                 | `test/retrieval-publication-races.test.ts`                                                                                                             | Required                                                                       |
| Full declared score is applied before the 40-candidate cap                                                | `test/brain-pilot.test.ts`                                                                                                                             | Required                                                                       |
| Slack historical cutoff excludes rebuild and delayed pre-cutoff evidence                                  | `test/retrieval-publication.test.ts`, `test/channel-policies.test.ts`                                                                                  | Implemented                                                                    |
| Evidence freshness uses source modification time, not ingestion/rebuild time                              | `test/retrieval-publication.test.ts`                                                                                                                   | Implemented                                                                    |
| Publication generation remains monotonic through revoke/restore                                           | `test/retrieval-publication.test.ts`                                                                                                                   | Implemented                                                                    |
| Terminal dead-letter repair is attributable and health reflects unresolved set                            | `test/retrieval-publication.test.ts`, `test/brain-pilot.test.ts`                                                                                       | Required                                                                       |
| Read switch CAS rejects stale receipt or unresolved required effects                                      | `test/brain-rollout-operations.test.ts`, `test/retrieval-publication-races.test.ts`                                                                    | Required                                                                       |
| Read switch CAS rejects claimed, leased, or running required effects                                      | `test/brain-rollout-operations.test.ts`, `test/retrieval-publication-races.test.ts`                                                                    | Required                                                                       |
| Rollback cannot resurrect deleted, unshared, or revoked legacy evidence                                   | `test/brain-rollout-operations.test.ts`, `test/headless-context.test.ts`                                                                               | Required                                                                       |
| Registered backfill, transcript migration, pause/resume, repair, status, validation, switch, and rollback | `test/brain-rollout-operations.test.ts`, exact-SHA `docs/superpowers/receipts/maestro-brain/company-brain/<sha>/staging-pilot-launch.md`               | Required                                                                       |
| Compatibility disabled and Codex/Claude manifest parity                                                   | `test/brain-pilot.test.ts`, `test/headless-context.test.ts`, exact-SHA `docs/superpowers/receipts/maestro-brain/company-brain/<sha>/runtime-parity.md` | Compatibility gate implemented; runtime parity receipt required                |

Each required row gains an engineering owner in its PR. Real-provider receipts
add the context owner and connector/access owner before WP03 or WP05 acceptance.

### Live Receipt Packet

Every staged snapshot, provider, runtime, dogfood, and rollout gate stores one
immutable receipt under a Company Brain and exact-SHA namespace (for example,
`docs/superpowers/receipts/maestro-brain/company-brain/<sha>/`). Historical
receipts are never overwritten or treated as current evidence. Each contains:

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

**WP00-WP01 packet preparation may begin now.** The real Claude inventory needs
a named context owner and Claude Project access holder; evaluation-question
capture needs its restricted location. Those values are still `TBD` in the
decision packet, so owner-dependent inventory is not represented as started.

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
