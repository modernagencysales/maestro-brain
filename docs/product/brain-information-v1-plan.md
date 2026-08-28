# Maestro Brain Information V1

**Status:** reviewed execution plan  
**Date:** 2026-08-28  
**Pilot:** Apero  
**Review:** rewritten after two rounds of independent blind architecture,
product, and delivery reviews, including the zero-dataset pilot constraint

## 1. Decision

Maestro Brain V1 will turn Slack threads, selected Drive documents, and
human-authored Brain Pages into one cited company-context surface for web,
terminal, Codex, Claude, Cowork, API, and HTTP MCP.

V1 is not an ontology project. It is a small information lifecycle:

```text
Provider data
  -> normalized immutable evidence
  -> direct recent-evidence retrieval
  -> exactly cited knowledge candidate
  -> human review
  -> supported company claim
  -> purpose-specific ContextPack
  -> answer with exact citations and explicit uncertainty
```

Brain Pages remain the readable company wiki. Slack channels and Drive folders
do not become Page folders. Agents keep their own provider tools; Brain supplies
shared context.

### The small V1 storage decision

Core knowledge V1 adds one table:

- `brainKnowledgeCandidates` for grounded extraction occurrences and their
  bounded review state.

The zero-data pilot adds one bounded operational table:

- `brainEvaluationExamples` for explicitly saved evaluation examples and
  missing-context/fallback observations. It stores source/revision references,
  not copied evidence excerpts, and is not a knowledge or ContextPack store.

Core V1 reuses or evolves:

- `brainEvidenceSources` and `brainEvidenceRevisions` for normalized immutable
  provider evidence;
- `brainRetrievalEntries` and `brainRetrievalTokens` for disposable bounded
  retrieval;
- `claims` and `citations` for candidate promotion and supported company truth;
- claim-local `verifiedAt` and `nextReviewAt` fields for review-due/stale
  projections;
- existing Brain Pages and Page revisions;
- the current pure ContextPack response contract.

Core V1 does not add:

- `brainEvidenceUnits`;
- topic or ontology tables;
- a generic proposal system;
- a graph database;
- a vector store;
- a separate ContextPack receipt store;
- Page-link, business-signal, or learning-loop infrastructure.

Those omissions are deliberate. The prior draft duplicated evidence, made
ContextPack persistence incompatible with the current query contract, and made
V1 too large.

## 2. Why the previous draft was not executable

Three cold reviewers independently returned **no-go as written, go on the core
direction**. The confirmed problems were:

1. `brainEvidenceUnits` copied content already owned by evidence revisions and
   retrieval entries. Its singular source revision could not represent a Slack
   thread containing many messages, and its offsets were ambiguous.
2. The plan required ContextPack persistence inside `answerQuestion`, which is
   currently a public Convex query and therefore cannot write.
3. One candidate could have multiple dispositions but only one review status.
   Direct evidence was incorrectly modeled as a review route.
4. The slice order added `company_truth` before reviewed claims existed.
5. The promised Slack-plus-documents outcome had a Slack-only definition of
   done.
6. The candidate fingerprint mixed proposition identity with evidence receipt
   identity, contradicting its corroboration behavior.
7. Review load, freshness conflicts, source withdrawal, terminal contracts,
   Slack capacity, and Claude Project replacement were not adequately gated.
8. Work packages did not follow this repository's required
   `fixture-to-real | pattern-instance | template-gap` planning contract.

This version corrects those defects rather than layering more tables over them.

## 3. V1 outcome

An Apero teammate should be able to:

1. From an empty workspace, select one narrow Slack or Drive scope and receive
   one exactly cited recent-evidence answer within 30 minutes.
2. Reopen that citation in the source, then link a terminal or HTTP MCP client
   to the same shared workspace.
3. Ask what the company believes, offers, charges, targets, has decided, or has
   recently discussed.
4. Receive a concise answer grounded in reviewed company knowledge and/or
   clearly labeled recent evidence.
5. Reopen every material citation to an exact Slack thread segment, Drive
   document revision, or Brain Page revision.
6. See uncertainty, conflicts, inaccessible evidence, and staleness rather than
   a fabricated resolution.
7. Review a small prioritized set of extracted knowledge candidates and accept,
   edit-and-accept, or reject them.
8. Insert an accepted claim and its citation into a Page as an explicit human
   edit rather than manually reconstructing the source.

The pilot replaces the recurring context-retrieval jobs of the Claude “Ask Apero
Advisors” Project. It does not need to replace Claude or Codex as an agent
runtime.

## 4. Scope

### V1A — cited recent evidence

- Slack threads as normalized evidence sources.
- Selected Google Drive documents as normalized evidence sources.
- Existing human-authored Brain Pages.
- Exact cited retrieval from all three.
- Empty-state onboarding, narrow sync preview, progress, results, and
  source-specific starter questions.
- `recent_evidence` Ask across web, CLI, API, and HTTP MCP.
- Progressive opt-in evaluation capture as real use accrues.

### V1B — reviewed company knowledge

- Category-light semantic extraction.
- Small human review queue.
- Supported claims and citations.
- `company_truth` and `mixed` Ask modes.
- One ContextPack value contract shared across web, CLI, API, and HTTP MCP.
- Source withdrawal, freshness, and conflict behavior.

### V1C — replacement validation

- Evaluation against the real Claude Project task set.
- A later time/source-separated holdout frozen from progressively collected
  tasks after the minimum sample exists.

### V1.1 after the core pilot passes

- Page update suggestions and Page-to-Page links.
- Read-only CRM/business-record references.
- ContextPack consumption observations.
- Tag-cluster DISCOVER reports.
- Outcome-informed ranking experiments.
- Semantic/vector candidate generation if evaluation proves it is necessary.

### Explicit non-goals

- universal company ontology;
- fixed fact/decision/SOP/story/metric taxonomy;
- automatic Slack-to-company-truth promotion;
- automatic Page body changes;
- provider structures copied into the Page tree;
- CRM writes;
- provider tool calling from Brain;
- Neo4j, pgvector, or an external vector database;
- all connectors before Slack and Drive work;
- permanent compatibility unions for hypothetical fixture rows;
- automated knowledge mutation from usage or outcomes.

## 5. Information model

### 5.1 Normalized evidence source

The current evidence layer is already the right source owner. V1 changes the
grain of provider normalization rather than introducing a second unit store.

| Provider | Normalized evidence source                                              |
| -------- | ----------------------------------------------------------------------- |
| Slack    | a bounded thread segment; an unthreaded message is a one-message thread |
| Drive    | a bounded heading/paragraph-aligned segment of one document revision    |
| Brain    | one Page revision                                                       |

The normalized source is immutable by revision. Retrieval passages are
disposable projections over its markdown.

### 5.2 Retrieval passage

The existing retrieval projection divides evidence into bounded overlapping
passages and token postings. A passage is a search candidate, not a durable
knowledge object.

Search results must always retain:

- provider;
- source key;
- immutable revision key;
- content hash;
- passage start/end offsets;
- provider locator;
- source-modified and observed times.

### 5.3 Knowledge candidate

A candidate is one grounded extraction occurrence from one source revision. It
is not accepted company truth and it has one V1 review purpose: decide whether
to create or support a company claim.

Direct use of evidence in `recent_evidence` mode bypasses candidates entirely.
Page-change and business-signal routes are V1.1 concerns.

### 5.4 Supported claim

A supported claim is a reviewed statement that may be used by `company_truth`.
It retains exact citations and a separate freshness projection.

Claims remain category-light:

- `epistemics: factual | subjective`;
- `quotability: 0..1`;
- free-form normalized tags;
- optional external record references only after V1;
- temporal scope where the statement itself is time-bound.

### 5.5 Brain Page

A Page is maintained narrative context. Existing Pages already participate in
evidence retrieval and remain part of company truth. V1 does not generate Page
body changes. A reviewer may manually incorporate an accepted claim into a Page
with its citation visible.

### 5.6 ContextPack

A ContextPack is a pure, bounded value returned with an answer. It is not a V1
database lifecycle.

Every surface calls one canonical assembler/capability and projects the same
returned pack. `packHash` content-addresses that returned pack; it is not a
timeless query identity because eligibility may change between invocations.

## 6. Evidence contracts

### 6.1 Slack source contract

Extend the Slack snapshot before changing projection:

```ts
type SlackMessage = {
  timestamp: string;
  revisionTimestamp: string;
  threadRootTimestamp: string;
  parentTimestamp: string | null;
  authorId: string;
  authorDisplayName: string | null;
  text: string;
  locator: string;
};
```

Provider metadata added to evidence source/revision rows:

```ts
type SlackEvidenceMetadataV1 = {
  schemaVersion: 1;
  channelId: string;
  channelName: string;
  threadRootTimestamp: string;
  segmentIndex: number;
  segmentCount: number;
  messageRefs: Array<{
    timestamp: string;
    revisionTimestamp: string;
    authorId: string;
    locator: string;
    renderedStartOffset: number;
    renderedEndOffset: number;
  }>;
};
```

`brainEvidenceSources` and `brainEvidenceRevisions` gain optional versioned
provider metadata. The metadata is part of the evidence content/identity check;
the same revision key cannot resolve to changed metadata.

### 6.2 Slack thread rendering and bounds

One thread becomes one or more bounded normalized sources:

```text
slack:<channelId>:thread:<rootTimestamp>:segment:<index>
```

Initial hard limits:

- at most 32 messages per segment;
- at most 24,000 rendered characters per segment;
- at most 48 retrieval passages per source, preserving the current projection
  bound;
- at most 1,000 messages per manual pilot sync;
- at most the explicitly selected channel set;
- initial history horizon: 90 days, configurable per workspace;
- no silent truncation: overflow produces another deterministic segment or an
  explicit capacity failure.

Rendering rules:

1. Sort root and replies by Slack timestamp.
2. Render display name or stable author ID, timestamp, and message text.
3. Keep message boundaries; never split a message unless one message alone
   exceeds the source bound.
4. Preserve the existing title-plus-markdown `contentHash` contract. Add a
   separate `providerMetadataHash`; derive the new-format immutable revision
   identity from both hashes and the normalization version.
5. Set source-modified time to the newest constituent revision timestamp.
6. Render stable author IDs in immutable text. Keep mutable display names and
   channel labels in provider metadata rather than changing content under an
   existing revision identity.
7. Preserve thread-root identity in every segment.
8. A successful new-format reconciliation retires old current message-level
   sources in the same scope. Historical revisions remain until normal lifecycle
   deletion.

### 6.3 Slack operational policy

- V1A starts with manual, bounded complete reconciliation of the selected
  channel window. Scheduled sync stays disabled.
- A high-water mark may accelerate discovery of new roots, but cannot establish
  completeness for replies, edits, or deletions in old threads.
- Before scheduled sync is activated, prove one deliberate strategy from pilot
  evidence: Slack Events plus periodic reconciliation, bounded overlapping
  rescans with known-root refresh, or periodic bounded complete reconciliation.
- Honor Slack `429 Retry-After` with bounded retries.
- Resolve users with one paginated/cached user inventory, not `users.info` per
  message.
- Publish with bounded concurrency rather than one unbounded fan-out.
- Provider traversal completes before publication starts.
- Successful source upserts may advance independently and are idempotently
  resumable; V1 does not claim whole-channel atomic visibility.
- A partial or failed traversal cannot infer removals. Only a completed
  reconciliation may retire missing current sources.
- Every publish checks the connection generation. Revoke during sync stops
  further publication and prevents removal inference.
- Alert on rate-limit exhaustion, repeated channel failure, or capacity failure.

### 6.4 Drive source contract

Normalize one Drive revision into deterministic bounded document segments; a
small document remains one segment:

```text
google_drive:file:<fileId>:segment:<index>
```

Each segment records file identity, provider revision, segment index/count,
whole-document body hash, rendered source offsets, heading boundary, and
normalization version. Apply the same 24,000 rendered-character and 48-passage
hard bounds as Slack. A single oversized paragraph produces an explicit capacity
state; it cannot silently truncate or fail publication for unrelated files.

The core document vertical must prove:

- Google Doc/text export;
- heading/paragraph-bounded passage citations;
- edit creates a new revision;
- move outside approved roots, unshare, or delete removes current eligibility
  only after a complete reconciliation;
- incomplete traversal cannot infer removals, while successfully published
  current revisions remain eligible;
- binary-only files remain metadata-only and are never presented as read text;
- Page and Drive copies of the same document do not appear twice in one pack
  when a normalized body hash and provenance identify the duplication.

### 6.5 Evidence lifecycle and withdrawal

Withdrawal reasons are not equivalent:

| Event                         | Raw evidence                                                        | Supported claim                                                                      | Page text copied by a human                                                                       |
| ----------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| Connector disconnected        | ineligible for direct retrieval                                     | remains but becomes `review-due` if its citations cannot reopen                      | remains with source-unavailable indicator when linked                                             |
| Scope/channel/root removed    | current source retires                                              | sole-supported claim becomes `review-due`; high-risk answers cannot rely on it alone | remains pending human review                                                                      |
| Provider deletion/unshare     | current source retires after complete reconciliation                | same as scope removal                                                                | remains pending human review                                                                      |
| Explicit purge/legal deletion | source and governed derived quotes follow deletion/redaction policy | claim is hidden or disputed when support is purged                                   | copied quoted material is redacted; independent human-authored paraphrase follows declared policy |
| Temporary provider failure    | previous complete projection remains current                        | unchanged                                                                            | unchanged                                                                                         |

Retrieval checks citation eligibility at read time. Human acceptance does not
make an inaccessible citation magically reopenable.

## 7. Knowledge candidate contract

### 7.1 One new table

```ts
type BrainKnowledgeCandidateV1 = {
  workspaceId: Id<"workspaces">;

  // Receipt identity: occurrence + extractor policy.
  candidateReceiptKey: string;
  sourceKey: string;
  sourceRevisionKey: string;
  extractionWindowKey: string;
  extractionPolicyVersion: string;

  // Proposition identity excludes evidence so corroboration can cluster.
  propositionFingerprint: string;
  body: string;
  epistemics: "factual" | "subjective";
  quotability: number;
  tags: string[];
  temporalScope: {
    validAt: number | null;
    expiresAt: number | null;
  };

  evidence: Array<{
    sourceKey: string;
    revisionKey: string;
    contentHash: string;
    quote: string;
    startOffset: number;
    endOffset: number;
    locator: string | null;
  }>;

  extractionConfidence: number;
  currentState: "unreviewed" | "accepted" | "rejected" | "stale";
  reviewRevision: number;
  reviewHistory: Array<{
    revision: number;
    action: "accept" | "edit_and_accept" | "reject" | "mark_stale";
    bodyHash: string;
    reason: string | null;
    actorId: string;
    idempotencyKey: string;
    occurredAt: number;
  }>;

  createdAt: number;
  updatedAt: number;
};
```

V1 enforces:

- maximum four evidence quotes per candidate;
- maximum four tags;
- maximum candidate body length;
- maximum eight review-history events inline;
- optimistic concurrency through `expectedReviewRevision`;
- idempotent review actions;
- a reviewed candidate is never overwritten by re-extraction;
- a new source revision or extractor policy creates a new receipt;
- same proposition fingerprint clusters occurrences for review but never
  silently merges them.

Only grounded candidates are persisted in this table. Rejected model records
contribute to bounded run metrics but never become knowledge rows.

If real review histories exceed the bound, that is the measured trigger for a
dedicated append-only review-event owner. Do not add it preemptively.

### 7.2 Extraction behavior

Extraction runs once for one bounded current retrieval entry/source revision.
Slack thread segments and Drive document segments therefore share one truthful
job grain.

The model returns zero to five candidate occurrences containing:

- concise proposition;
- exact quote;
- epistemics;
- quotability;
- one to four tags;
- optional temporal scope.

Code performs:

- exact normalized substring validation;
- exact offset calculation against the reopened source revision;
- content-hash verification;
- candidate-receipt identity;
- proposition fingerprinting;
- tag formatting;
- schema and capacity validation.

After the model call, one final internal mutation reopens the entry, validates
its current revision and hashes, inserts all grounded candidate receipts, and
marks that entry's semantic projection complete. Failure inserts no candidates
for that attempt. Candidate queries require a current source/revision and a
completed semantic projection.

V1 publishes independently per bounded entry. It does not promise atomic
all-channel or all-workspace candidate generations. Aggregate grounding failure
is an operational circuit breaker:

- alert when a run with at least ten proposed candidates exceeds 30% grounding
  failure;
- pause new extraction for that channel/source scope;
- preserve existing candidates and supported claims;
- require an extractor-policy evaluation before resuming.

### 7.3 Extraction state and replay

The current retrieval entry receives small optional semantic projection state:

```ts
{
  semanticPolicyVersion?: string;
  semanticStatus?: "pending" | "running" | "completed" | "failed";
  semanticProposedCount?: number;
  semanticCandidateCount?: number;
  semanticGroundingFailureCount?: number;
  semanticFailureCode?: string | null;
  semanticProjectedAt?: number;
}
```

This records zero-candidate completion and prevents infinite retries without a
new run table. Evidence owns these projection-state writes through an internal
capability; extraction cannot directly mutate retrieval state. The candidate
receipt remains the durable model-output record. Workspace extraction rollout
and its kill switch use the existing policy-and-prompts owner rather than a
per-entry `paused` flag.

### 7.4 Tag vocabulary

V1 supplies at most the 50 most recently accepted/reused workspace tags to the
extractor. The vocabulary is derived by a bounded index/query over supported
claims, cached in process for the extraction batch, and never requires a topic
table.

If that query cannot remain bounded, add a rebuildable tag-count projection only
after measuring the problem.

## 8. Claims, citations, and freshness

### 8.1 Audit before migration

Before changing schemas, inspect staging and production counts/shapes for
`claims`, `citations`, and `contextPacks`. Do not preserve hypothetical fixture
rows forever.

Choose one of two paths based on evidence:

- no material customer rows: replace the fixture contract cleanly and record a
  migration receipt;
- material rows: use expand, bounded backfill, cutover, rollback window, then
  contract.

### 8.2 Canonical claim lifecycle

The V1 canonical lifecycle is:

```text
supported | disputed | archived
```

Legacy `unsupported-draft` remains readable only during a proven migration
window. Knowledge candidates, not claims, own unreviewed extraction.

Accepting a candidate transactionally:

1. verifies `expectedReviewRevision` and idempotency key;
2. reopens every cited source revision and verifies content hashes/quotes;
3. creates or updates the supported proposition;
4. inserts immutable citations;
5. records the candidate review event;
6. initializes claim-local `verifiedAt` and `nextReviewAt`;
7. returns the claim and citation identities.

### 8.3 Freshness

Freshness is separate from claim lifecycle. The current `versionFreshness`
surface is fixture-owned generic versioning, so V1 does not silently depend on
it. Add optional `verifiedAt` and `nextReviewAt` fields to the evolved claim
shape and derive freshness in knowledge/context. Moving this back to generic
versioning requires a separate fixture-to-real work package.

At acceptance, the reviewer may choose a review horizon; otherwise V1 defaults
to 90 days. The default is policy, not schema. Verification refreshes
`nextReviewAt` without rewriting the claim. Source withdrawal can move a claim
to `review-due` immediately.

High-risk current-state questions include prices, active offers, policy,
contract terms, current staff responsibility, and live deal status. If all
supporting claims are stale, disputed, or citation-inaccessible, the system must
abstain or explicitly answer historically. It cannot silently use them as
current truth.

### 8.4 Conflict behavior

V1 does not ask a model to resolve conflicts silently.

When reviewed knowledge and recent evidence materially disagree:

1. show the reviewed claim and its status;
2. show the newer evidence separately as unreviewed;
3. identify the time/source difference;
4. abstain from one definitive current answer for high-risk questions.

V1 answer synthesis may label a possible conflict between retrieved items. It
does not persist a conflict or create a candidate automatically; that requires a
later measured contradiction-extraction contract.

## 9. Retrieval and ContextPack contract

### 9.1 Evidence modes

| Mode              | Eligible information                                        | Intended use                               |
| ----------------- | ----------------------------------------------------------- | ------------------------------------------ |
| `recent_evidence` | current Slack/Drive/Page evidence                           | “What was discussed or changed recently?”  |
| `company_truth`   | supported fresh/review-due claims plus active curated Pages | “What is our maintained offer/policy/ICP?” |
| `mixed`           | company truth first, labeled current evidence second        | normal Ask Apero questions                 |

V1 ships in that order: recent evidence first, then review/claims, then company
truth and mixed.

### 9.2 Candidate generation

1. Normalize bounded query tokens.
2. Retrieve co-located passage candidates with the current postings index.
3. Retrieve supported claim title/body/tag matches when that lane exists.
4. Apply evidence-mode eligibility before ranking.
5. Reopen exact revisions and verify hashes before material inclusion.
6. Deduplicate Page/Drive content by content hash and provenance.
7. Select a bounded set with coverage across material query terms.

Semantic/vector retrieval may later add candidates. It never replaces these
checks.

### 9.3 Ranking

Keep ranking inspectable:

```text
score = lexical/task relevance
      * evidence-mode eligibility
      * review-state weight
      * configured source authority
      * freshness weight
      + exact accepted-tag match
      + corroboration display boost
```

No opaque global importance score mutates truth. Ranking explanations use
product language such as:

- Reviewed company knowledge
- Recent Slack thread
- Current Drive document
- Review due
- Conflicts with newer evidence

### 9.4 ContextPack V4 value

```ts
type ContextPackV4 = {
  schemaVersion: "4";
  packHash: string;
  purpose: string;
  evidenceMode: "recent_evidence" | "company_truth" | "mixed";
  question: string;
  asOf: number;
  freshness: "current" | "review-due" | "stale" | "unknown";
  reviewedClaims: Array<{
    claimId: string;
    body: string;
    freshness: string;
    citationKeys: string[];
  }>;
  evidence: Array<{
    citationKey: string;
    provider: string;
    sourceKey: string;
    revisionKey: string;
    contentHash: string;
    title: string;
    quote: string;
    startOffset: number;
    endOffset: number;
    locator?: string;
    freshness: string;
    reviewState: "reviewed" | "unreviewed";
  }>;
  conflicts: Array<{
    reviewedClaimId: string;
    evidenceCitationKey: string;
    explanation: string;
  }>;
  omissions: Array<{ reason: string; count: number }>;
  retrievalPolicyVersion: string;
};
```

`packHash` covers canonical selected content and policy, not surface or
invocation. The pack remains query-returned and ephemeral in V1.

If usage observations become necessary, a later explicit idempotent mutation
records only `packHash`, surface, purpose, timestamp, and request key with a
declared TTL. It does not copy queries or excerpts.

## 10. Review UX and workload controls

The review queue is not a second inbox firehose.

### Queue behavior

- surface at most five candidates per workspace per week during the pilot and
  never exceed the remaining 15-minute review budget; keep additional candidates
  shadowed;
- at most five candidates from one source revision;
- prioritize likely reusable claims, conflicts, and corroboration;
- group same-fingerprint candidates into one card;
- allow accept, edit-and-accept, reject, bulk reject, pause source, and mute
  tag;
- expire untouched unreviewed candidates from the active queue after 30 days
  while retaining their source evidence;
- show exact quote, source, freshness, reason, and existing related claim;
- assign one workspace knowledge owner for the pilot;
- send/show one digest, not continuous candidate notifications.

### Workload gates

- median review time per candidate;
- useful acceptances per review hour;
- candidates per reviewer per week;
- active backlog size and age;
- rejection reasons;
- no surfaced candidate older than seven days in the active pilot queue;
- target no more than 15 review minutes per reviewer per week.

If the queue exceeds those gates, pause or raise extraction thresholds. Do not
solve an extraction-quality problem by adding reviewers.

### Page-centered interface

Existing Pages remain primary. The review queue uses the installed Starter
Inbox/list-detail composition through a thin adapter. It does not create a new
Brain shell.

V1 Page affordances are limited to:

- reviewed/review-due/source-unavailable status;
- citation/source drawer;
- copy an accepted claim and citation into the existing editor as a normal human
  Page edit, without a second association lifecycle;
- Page owner and last verified time where configured.

Automated before/after Page suggestions and Page graph links remain V1.1.

## 11. Headless contract

Workspace is implicit for a linked CLI/API key. Web-internal calls may carry the
workspace identity resolved from the route/session. Public HTTP MCP tools never
accept an arbitrary workspace selector.

### Canonical operations

```text
brain.ask
brain.evidence.search
brain.evidence.open
brain.knowledge.listCandidates
brain.knowledge.reviewCandidate
brain.claims.list
brain.claims.get
```

`brain.ask` input:

```json
{
  "question": "What did we decide about the advisory offer?",
  "purpose": "company-question",
  "evidenceMode": "mixed",
  "asOf": 1787932800000,
  "maxCitations": 6
}
```

Output includes answer status, answer markdown, ContextPack V4, pack hash,
citations, freshness, conflicts, and omissions.

### CLI behavior

```text
maestro-brain ask "What is our current advisory offer?" --mode company-truth
maestro-brain ask "What changed this week?" --mode recent-evidence --json
maestro-brain evidence open <source-key> --revision <revision-key>
maestro-brain knowledge review <candidate-key> --accept --expected-revision 0
```

- human mode prints a concise answer followed by numbered citations;
- `--json` emits the complete stable wire contract;
- insufficient context exits successfully with status `insufficient-context`,
  not a fabricated answer;
- invalid credentials, stale review revision, inaccessible evidence, and
  provider failure use distinct non-zero exit codes;
- review writes are owner/admin during pilot and require an idempotency key;
- Cowork/Claude may use the same HTTP MCP without installing the local CLI.

### Cross-surface parity

Web, CLI, API, and HTTP MCP call the same V4 capability and preserve one
returned value:

- selected source/revision identities are unchanged by adapters;
- `packHash` is computed once from canonical sorting/serialization;
- citation reopening is delegated to the same operation;
- surface-specific formatting may differ;
- no surface creates a separate context store.

Codex, Claude, and Cowork are HTTP MCP consumers, not additional bespoke backend
adapters. V3 remains available during a measured compatibility window; V4 is
additive until no active consumer depends on V3.

## 12. Module boundaries

```text
integrations/
  Provider pagination, rate limits, normalized snapshots.

brain/evidence/
  Immutable sources/revisions, reconciliation, retrieval projection, reopening.

brain/extraction/
  Prompt contract, grounding, fingerprints, candidate persistence.

brain/knowledge/
  Candidate review, supported claims, citations, freshness.

brain/context/
  Evidence modes, ranking, conflict projection, ContextPack V4.

brain/pages/
  Existing Page authoring/revisions and manual claim association.
```

Dependency direction:

```text
integrations -> evidence -> extraction -> knowledge -> context
                   \-------------------------------> context
                                      knowledge -> pages
```

Rules:

- provider adapters cannot write candidates or claims;
- extraction cannot activate claims;
- retrieval cannot mutate truth;
- Pages do not own provider ingestion;
- pure functions own rendering, bounds, hashes, grounding, fingerprinting,
  ranking, and pack assembly;
- Convex handlers authorize, load bounded rows, invoke pure logic, and persist
  through one owner.

## 13. Repository-native work packages

All implementation starts with:

```text
pnpm maestro -- preflight --mode fake
```

The current untracked plan causes `AGENT_PACK_DIRTY_OVERLAP`; resolve that
worktree state before implementation previews. Generator commands below are
preview-only until reviewed, then rerun with `--write`.

### WP0 — Progressive pilot evaluation scaffold

**Classification:** `fixture-to-real` plus evaluation table `pattern-instance`  
**System:** `knowledge-brain` / `extend`  
**Existing fixture/seam:** synthetic source-grounded brief/evidence tests and
the unscored activation question set  
**Real boundary:** empty-manifest evaluator, synthetic safety fixtures, and an
explicit opt-in rolling example ledger populated during pilot use

Preview:

```text
pnpm template:add-table --name brainEvaluationExamples --system knowledge-brain --disposition extend --tenant-scope workspace --sensitivity confidential --pii customer-content --export-mode redacted-json --delete-mode delete --retention retain-until-workspace-delete
```

Deliver:

- a valid empty external fixture manifest and synthetic Slack/Drive fixtures;
- metric definitions, maturity states, capture schema, and evaluation tooling;
- three to five initial recurring jobs from a short owner interview when
  available, without blocking implementation;
- explicit web feedback actions (`Useful`, `Needs work`, `Save as test`) and CLI
  `--save-example` behavior;
- a bounded evaluation-example owner containing question, purpose, mode,
  source/revision references without copied excerpts, pack hash, answer status,
  usefulness, missing-source/correction/fallback reason, timestamps, split,
  retention, export, and deletion posture;
- no automatic logging of full questions;
- encrypted or externally stored customer fixture payloads with committed hashes
  and aggregate results only.

**UI template gap `BRAIN-TG-002`:** the canonical Search screen is protected by
its purchased-screen destination receipt. A direct `Useful` / `Needs work` /
`Save as test` edit correctly fails `typecheck:saas-ui` with a destination-hash
mismatch. Keep the shared save-example mutation available to CLI, API, and HTTP
MCP, and add the web actions only through a generated Search extension seam or
an upstream receipt refresh. Do not fork the canonical screen to close WP0.

Focused gates:

- empty and populated manifests contain no customer text;
- repeated input replay is stable;
- evaluator always reports denominators and returns `insufficient-sample`,
  `provisional`, or `exit-eligible` maturity;
- synthetic exact reopening, withdrawal, insufficient-context, and surface
  parity cases pass.

### WP1 — First cited recent-evidence vertical

**Classification:** `fixture-to-real`  
**System:** `knowledge-brain` / `extend`  
**Existing fixture/seam:** current message-level Slack snapshot and provider
evidence projection  
**Real boundary:** bounded Slack thread sources and selected Drive documents
through the existing evidence owner

Deliver:

- empty-state CTA and one selected-channel default;
- 14-30 day initial window with estimated sync count preview;
- Slack metadata/normalization contract and bounds;
- optional provider metadata on evidence source/revision rows;
- thread-segment renderer and reconciliation;
- manual Slack sync with progress, result counts, and source health;
- three source-specific starter questions;
- `recent_evidence` ContextPack V4 and exact search/open through web, CLI, API,
  and HTTP MCP behind one workspace flag;
- source withdrawal matrix and tests;
- rate-limit, retry, capacity, connection-generation, and revoke-during-sync
  tests;
- scheduled Slack sync remains disabled.

Required updates:

- schema decision for changed evidence metadata;
- data lifecycle/export/delete documentation;
- system catalog/app map/product behavior receipts;
- focused evidence, Slack integration, Drive integration, and MCP contract
  tests.

WP1 may start with no customer dataset. Its product gate is one real selected
source producing one exactly reopenable cited answer or an explicit
insufficient-context result within 30 minutes.

### WP1D — Bounded Drive recent evidence

**Classification:** `fixture-to-real`  
**System:** `knowledge-brain` / `extend`  
**Existing fixture/seam:** current whole-file Drive snapshot and evidence
projection  
**Real boundary:** deterministic bounded document segments with exact provider
revision provenance

Deliver Drive segment metadata, oversized-paragraph capacity behavior,
edit/move/unshare/delete acceptance, and the 2 MB input-versus-projector-bound
regression fixture. Scheduled provider automation is not required for V1A.

### WP2 — Grounded candidate extraction

**Classification:** `pattern-instance`  
**System:** `knowledge-brain` / `extend`

Preview:

```text
pnpm template:add-table --name brainKnowledgeCandidates --system knowledge-brain --disposition extend --tenant-scope workspace --sensitivity confidential --pii customer-content --export-mode redacted-json --delete-mode delete --retention retain-until-workspace-delete
pnpm template:add-capability --name extractBrainKnowledgeCandidates --system knowledge-brain --disposition extend --description "Extract bounded, exactly cited company-knowledge candidates from current Brain evidence" --exposure workflow
```

Deliver:

- reviewed generated provenance;
- candidate schema and lifecycle decision;
- bounded action-backed extraction capability; V1 does not require durable
  workflow orchestration;
- exact grounding, fingerprints, tag convergence, cost limits, and circuit
  breaker;
- shadow extraction and candidate inspector;
- no candidate visibility from incomplete/failed work;
- daily/workspace token and spend cap, concurrency cap, retry cap, and kill
  switch.

Focused gates:

- zero ungrounded visible candidates;
- idempotent replay;
- policy change creates new receipts without changing reviewed candidates;
- oversized passage, model timeout, malformed output, and cost-cap behavior;
- cross-workspace isolation and lifecycle export/delete coverage.

### WP3 — Review and supported company claims

**Classification:** `fixture-to-real` plus UI `template-gap`  
**System:** `knowledge-brain` / `extend`  
**Existing fixture/seam:** dormant `claims`, `citations`, and fixed knowledge
contracts  
**Real boundary:** candidate review transaction creates supported claims and
reopenable Slack/Drive/Page citations

Preview:

```text
pnpm template:add-capability --name reviewBrainKnowledgeCandidate --system knowledge-brain --disposition extend --description "Review a grounded Brain candidate into supported company knowledge" --exposure web
```

**UI template gap `BRAIN-TG-001`:** the intended canonical source is
`starter-route:apps/web/src/routes/_app/$workspace/_dashboard/inbox.tsx`, but
the current `template:add-feature` preview fails closed because
`apps/web/src/components/user-avatar.tsx` is not bound into the selected
screen's generated import receipt. Do not hand-copy or redesign the screen.
Promote this slice only after the template authority repairs/regenerates the
Starter Inbox closure and receipt following
`docs/template/saas-ui-upstream-update.md`; then rerun and review:

```text
pnpm template:add-feature --name brainKnowledgeReview --system knowledge-brain --disposition extend --screen-catalog-id 'starter-route:apps/web/src/routes/_app/$workspace/_dashboard/inbox.tsx' --description "Review prioritized cited company-knowledge candidates"
```

Until `BRAIN-TG-001` is resolved, candidate review may be exercised through the
generated capability contract and a test/operator harness, but WP3 is not
complete and the pilot cannot claim a team-ready review UI.

Deliver:

- live-row audit;
- expand/backfill/cutover/rollback or clean fixture replacement based on audit;
- canonical claim and citation validators/indexes;
- atomic candidate review with optimistic concurrency/idempotency;
- freshness initialization and source-withdrawal propagation;
- bounded queue UX and workload controls;
- headless review capability only if pilot reviewers require terminal writes.

Focused gates:

- every supported claim has a reopening citation;
- duplicate accept/reject is idempotent;
- stale review revisions fail without mutation;
- old code reads expanded rows during rollback window;
- failed bounded backfill resumes;
- reviewer workload gates pass in shadow sampling.

### WP4 — Company truth, mixed Ask, and cross-surface parity

**Classification:** `fixture-to-real`  
**System:** `knowledge-brain` / `extend`  
**Existing fixture/seam:** current excerpt-only `answerQuestion`, HTTP MCP Ask,
and fixed `ops/knowledge` ContextPack fixture  
**Real boundary:** ContextPack V4 selects supported claims, Pages, and labeled
recent evidence through one pure assembler

Preview:

```text
pnpm template:add-capability --name askCompanyBrain --system knowledge-brain --disposition extend --description "Answer from reviewed company knowledge and exact current evidence" --exposure headless
```

Deliver:

- `company_truth` and `mixed` policies;
- freshness/conflict rules;
- deterministic `packHash`;
- web, CLI, API, and HTTP MCP adapters; Codex, Claude, and Cowork consume the
  HTTP MCP surface;
- no ContextPack database write from the public query;
- guarded workspace rollout and fallback to `recent_evidence`;
- full Claude Project replacement evaluation.

Focused gates:

- one returned pack retains selected source/revision identities and pack hash
  through every adapter;
- high-risk stale/conflicted questions abstain;
- no unsupported material claim;
- ContextPack capacities and latency budgets pass;
- revocation, removal, Page archive, claim dispute, and citation-inaccessible
  behavior passes;
- no fixture response remains on a production surface.

V1 stops after WP4. Page suggestions, Links, CRM references, usage receipts, and
DISCOVER require a separate reviewed plan based on pilot evidence.

## 14. Evaluation and release gates

### 14.1 Progressive dataset design

- Implementation begins with synthetic safety fixtures and an empty real-data
  manifest.
- Explicitly saved pilot examples form a rolling development set.
- Freeze a time/source-separated holdout only after at least 25-30 adjudicated
  real tasks exist; do not tune against that later slice.
- Use two adjudicators for the replacement sample and material disagreements,
  not every early pilot interaction.
- Run multiple extraction samples when measuring nondeterministic behavior.
- Always report exact denominators. Report confidence intervals only when the
  sample supports them; otherwise report `insufficient-sample` or `provisional`.
- Customer content stored outside Git; Git stores fixture hashes, rubric, and
  redacted aggregate results.

### 14.2 Integrity gates

- zero cross-workspace leakage;
- zero material citations that fail exact reopening;
- 100% high-risk material claims cited and entailed;
- incomplete provider traversal never infers removals and incomplete extraction
  never publishes candidates;
- incomplete extraction never appears in review;
- old code remains safe through the migration rollback window;
- explicit purge follows derived quote/claim/Page policy.

### 14.3 Pilot promotion quality gates

These gates do not block V1A activation. They become eligible only after the
declared minimum holdout exists:

- at least 90% supporting-source recall@5 on answerable holdout questions;
- at least 95% citation entailment across ordinary answered claims;
- correct abstention on at least 95% of unanswerable/high-risk stale cases;
- zero silent conflict resolution in the conflict fixture set;
- thread-aware retrieval materially beats the message-level baseline;
- semantic retrieval remains absent unless categorized lexical misses justify
  it.

### 14.4 Replacement gates

Over a two-to-four-week pilot:

- at least 90% of critical Claude Project tasks complete at parity or better;
- no critical task fails because a selected Drive source is absent;
- fallback to Claude Project is at most 10% after stabilization;
- two pilot users choose Brain as their default context path;
- median task completion time is at or below the Claude baseline;
- terminal setup succeeds from the documented onboarding path;
- review remains at or below 15 minutes per reviewer per week;
- no active review candidate remains older than seven days;
- Page maintenance does not increase materially over baseline.

### 14.5 Capacity and cost gates

Declare safe hard ceilings before activation:

- Ask timeout and maximum ContextPack capacity;
- extraction latency per source revision;
- model input/output token maximum per extraction;
- candidates per source and workspace/day;
- concurrent extraction jobs;
- retry cap;
- workspace daily spend cap;
- queue-depth hard cap;
- kill-switch behavior.

Crossing a hard cap pauses new extraction and preserves evidence/knowledge. It
does not silently truncate or delete.

## 15. Deferred-complexity triggers

| Addition                                   | Required evidence                                                                           |
| ------------------------------------------ | ------------------------------------------------------------------------------------------- |
| Semantic/vector candidate generation       | Holdout misses remain materially semantic after grouping, aliases, tags, and metadata fixes |
| Topic objects                              | Stable tag clusters have a named UI or retrieval consumer                                   |
| Specialized product/persona/segment tables | A shipped workflow reads/writes structured fields that generic references cannot support    |
| Page-change suggestions                    | Candidate acceptance is accurate and reviewers request Page maintenance help                |
| Brain Links graph                          | Page corpus and navigation questions demonstrate one-hop link value                         |
| Dedicated review-event table               | Real candidates exceed the bounded inline history safely                                    |
| Dedicated tag-count table                  | Accepted-tag vocabulary cannot be queried within declared bounds                            |
| Persisted ContextPack receipts             | A named audit/replay consumer justifies retention, export, deletion, and privacy cost       |
| Outcome-informed ranking                   | Attributed outcome volume beats the non-outcome baseline on holdout tasks                   |
| Topic clustering for unthreaded Slack      | Unthreaded-message retrieval remains a measured material gap                                |
| Graph database                             | Indexed shallow relations cannot meet a demonstrated traversal requirement                  |
| Scheduled Slack synchronization            | Pilot observations justify and prove Events, overlap scans, or periodic reconciliation      |

## 16. Prior-art disposition

| Prior work                | Keep                                                                        | Adapt/defer                                                                |
| ------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Current provider evidence | Immutable revisions, exact reopening, bounded retrieval, reconciliation     | Change Slack normalization grain; add metadata and operational bounds      |
| Maestro source-unit model | Evidence is not truth; direct evidence and knowledge promotion are separate | Use normalized sources/passages instead of a new durable unit table in V1  |
| Maestro simple Brain ADR  | Exact claims, free tags, deterministic grounding, no premature ontology     | Keep vectors/topics/position taxonomy deferred                             |
| Maestro Pages/Links       | Pages as public ontology and controlled changes                             | Pages remain; automatic changes and Links move to V1.1                     |
| Maestro freshness work    | Freshness separate from ledger lifecycle                                    | Keep claim-local V1 fields; reuse generic versioning only after it is real |
| MAS graph                 | Named-consumer business entities, use-case context, outcomes, gap detection | Do not port Supabase tables; revisit record references after core pilot    |
| MAS meeting extraction    | Coherent topic/thread grain, multiple grounded atoms, corroboration         | Apply to Slack/document extraction without copying category enums          |

Key references:

- `maestro/docs/architecture/source-unit-knowledge-model.md`
- `maestro/docs/product/brain/2026-06-12-brain-v1-simple.md`
- `maestro/docs/product/brain/ADR-001-brain-build-decisions.md`
- `maestro/docs/product/brain/ADR-002-brain-claim-freshness-decay.md`
- `maestro/docs/superpowers/specs/2026-06-28-brain-agentic-wiki-and-linking-design.md`
- `maestro/docs/superpowers/plans/2026-06-30-brain-launch-parallel-reviewed-execution-plan.md`
- `mas-platform/packages/knowledge-graph`
- `mas-platform/docs/superpowers/specs/2026-03-21-maestro-knowledge-graph-design.md`
- `mas-platform/docs/superpowers/specs/2026-05-04-meeting-extraction-pipeline-design.md`

## 17. Go/no-go

### Plan verdict

The architecture is now appropriately small and modular:

- one new core knowledge table plus one bounded pilot-evaluation owner;
- one normalized evidence owner;
- one supported-claim owner;
- one pure ContextPack value;
- progressive evaluation alongside the implementation work packages;
- no ontology, vectors, graph service, generic proposal engine, or receipt
  store.

### Implementation go condition

Implementation may begin only after:

1. the untracked-plan preflight overlap is resolved;
2. WP0's empty manifest, capture schema, synthetic safety fixtures, and
   evaluator pass;
3. one pilot owner and one narrow initial source scope are named;
4. Slack content/capacity bounds, manual-sync rollback controls, and workspace
   kill switch are declared.

The legacy claims/citations row audit is a WP3 entry gate, not a prerequisite
for WP1 evidence work. WP2-WP4 generator previews are reviewed before their own
packages begin.

### V1 definition of done

V1 is complete when:

- real Slack threads and selected Drive documents synchronize as bounded,
  current, exactly reopenable evidence;
- `recent_evidence` works before any semantic promotion;
- grounded candidates can be reviewed into supported claims without automatic
  truth promotion;
- `company_truth` and `mixed` enforce freshness, accessibility, and conflict
  behavior;
- web, CLI, API, Codex, Claude, Cowork, and HTTP MCP return the same ContextPack
  content identity and citations;
- the frozen evaluation and two-to-four-week pilot pass integrity, quality,
  workload, capacity, and Claude-replacement gates;
- no V1 deferred system was added without its measured trigger.
