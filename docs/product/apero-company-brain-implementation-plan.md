# Apero Company Brain Data-First Implementation Plan

**Status:** proposed execution plan

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
2. Use one canonical context operation on every surface.
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
| M1        | One canonical context path works on every read surface         | WP02      |
| M2        | Real existing Apero evidence passes E0                         | WP03      |
| M3        | Ask Apero works for one to two users in both runtimes          | WP04      |
| M4        | First new provider passes the complete data-flow contract      | WP05-WP06 |
| M5        | Highest-value structured source passes E2                      | WP07      |
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

Gmail, DocuSign document retention, write approval, granular permissions, and
multi-Brain composition default to **not authorized for the pilot** and do not
block M0.

**Exit gate:** E0 can be run reproducibly and each question names the evidence
required to judge it.

### WP02 — Make `brain.context.get` Canonical

**Timebox:** 3-5 engineering days

**Outcome:** web, API, CLI, and MCP use one deterministic context operation.

Write a short contract ADR that:

- selects `brain.context.get` as the canonical read projection;
- keeps `capabilities.sourceGroundedBrief` separate as a generated-brief
  mutation, outside the pilot critical path;
- makes the pilot contract one-Brain-scoped;
- defines deterministic byte/candidate budgets and omission metadata;
- defines stable errors for unavailable, stale, and insufficient evidence.

Then:

1. make the legacy headless path delegate to the canonical implementation or
   remove it;
2. add parity tests for the human and headless paths;
3. stop hard-coding freshness as `current`;
4. return exact revision and passage identifiers;
5. return entry-level source/observed/indexed timestamps;
6. report truncation and omitted entry counts;
7. use the existing viewer read role.

The pilot ContextPack should contain at least:

```ts
type ContextEntry = {
  brainKey: string;
  kind: "page" | "source" | "projection";
  sourceKey: string;
  revisionKey: string;
  unitKey?: string;
  segmentKey?: string;
  title: string;
  excerpt: string;
  locator?: string;
  contentHash?: string;
  authority: "authoritative" | "derived" | "advisory";
  sourceModifiedAt?: number;
  observedAt?: number;
  indexedAt?: number;
  freshness: "current" | "stale" | "unknown";
  truncated: boolean;
};
```

**Focused gates:** exact existing test files or newly created test files only.
Focused commands must fail when zero tests match. Run the web/headless contract
gate and a repository integration gate at the package boundary.

**Exit gate:** the same request through web/API/CLI/MCP returns the same active
revision set, freshness state, citations, and truncation metadata.

### WP03 — Prove Existing Apero Evidence

**Timebox:** 2-4 engineering days, depending on existing data state

**Outcome:** E0 passes on real Brain pages, Slack, and transcripts before a new
connector is built.

Tasks:

1. inventory actual Apero sources currently stored;
2. confirm routing into the agency Brain;
3. identify fake, fixture, unpublished, or empty sources;
4. perform the required approved backfill;
5. validate source revisions and passage citations;
6. verify that one new and one edited Slack/transcript observation becomes
   retrievable;
7. verify deletion/unpublication behavior;
8. record current coverage and gaps.

**Exit gate:** a real-data receipt demonstrates at least ten E0 questions using
resolvable citations, and no fixture is represented as live evidence.

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

### WP05 — Build A One-Container Provider Walking Skeleton

**Timebox:** 3-5 engineering days

**Default source:** one dedicated Shared Drive folder, unless WP00 proves a
different source is more valuable and similarly bounded.

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

**Exit gate:** a dedicated test object passes create, edit, move out, unshare,
delete, duplicate delivery, full resync, retrieval, and citation-open tests
against the real provider.

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

Run the repository integration gate after this slice. Any known broad TypeScript
baseline must be exact, non-expanding, and separate from new errors.

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

### WP08 — Run Two-User Dogfood And Rehearse Rollback

**Timebox:** 1-2 calendar weeks, overlapping normal work

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

Before expanding, rehearse:

1. disable Ask Apero delivery;
2. stop new connector sync;
3. allow or cancel leased jobs deliberately;
4. revoke pilot keys;
5. verify the previous workflow still works;
6. restore the pilot without a full re-ingestion when appropriate.

**Exit gate:** both users choose Ask Apero for the covered question set, major
data-flow failures are resolved, and rollback completes from the written
runbook.

### WP09 — Run The Five-User Read Pilot

**Timebox:** 1 calendar week

Freeze the deployment revision, connector configuration, team manifest, and
evaluation versions. Issue the remaining read-only credentials and run E0-E3.

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

| Sequence | Work                               | Indicative elapsed time |
| -------- | ---------------------------------- | ----------------------- |
| 1        | WP00-WP01 inventory and evaluation | 2-3 business days       |
| 2        | WP02 canonical context path        | 3-5 engineering days    |
| 3        | WP03 existing evidence proof       | 2-4 engineering days    |
| 4        | WP04 Ask Apero thin slice          | 2-3 engineering days    |
| 5        | WP05-WP06 first provider           | 1-2 engineering weeks   |
| 6        | WP07 structured source             | 1-2 engineering weeks   |
| 7        | WP08 two-user dogfood              | 1-2 calendar weeks      |
| 8        | WP09 five-user pilot               | 1 calendar week         |

OAuth approval, provider sandbox access, source-owner review, or CRM custom
field mapping may dominate elapsed time. Each package should name an engineering
DRI, business DRI, external dependency, and maximum timebox before it starts.

## 9. First Ten Actions

1. Inventory the Claude Ask Apero Project and build the migration matrix.
2. Capture and classify the E0 recurring questions.
3. Name the context owner, engineer, and first two users.
4. Write the ADR selecting `brain.context.get` as the canonical context pack.
5. Add web/headless context parity tests.
6. Remove or delegate the divergent legacy headless implementation.
7. Replace hard-coded freshness and silent truncation.
8. Prove real Apero Brain-page, Slack, and transcript evidence with E0.
9. Package Ask Apero and dogfood it in Codex and Claude Code.
10. Connect one dedicated shared provider container and pass the complete
    create-to-delete lifecycle before expanding its scope.

## 10. Deferred Hardening Register

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
