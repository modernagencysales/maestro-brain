# Apero Company Brain Architecture

**Status:** recommended product direction **Date:** 2026-08-20

## Decision

Use Maestro Brain as Apero's shared context control plane, not as a company file
dump, a replacement CRM, or a generic agent runtime.

The useful split is:

```text
systems of record             company context plane              agent runtimes
-----------------             ---------------------              --------------
CRM / Monday                  exact source ledger                Codex / Claude Code
Drive / Gmail        --->     normalized source units     --->   approved skills
DocuSign / Notion             curated Brain pages                agent-owned tool grants
Slack / call tools            citations + revisions              task-specific execution
                              retrieval + Ask API/MCP
```

Maestro Brain owns the middle. Source applications remain authoritative for
their records. Agents own task execution and tool calling. The Brain gives all
agents the same current, cited, permission-scoped context.

## What The Repository Already Has

This repository is much closer to the desired product than its old UI made it
look:

- organization, agency-Brain, and client-Brain tenancy with
  `viewer | editor | admin | owner` authorization;
- stable page trees, immutable revisions, citations, review queues, restore,
  lifecycle generations, audit events, and deterministic export;
- an exact source ledger (`brainSources`, `sourceArtifacts`, `sourceUnits`,
  revisions, segments, processing jobs, and connector sync state);
- workspace-scoped retrieval, cited Ask, API keys, CLI, and stateless MCP;
- one shared Slack/Nango control plane, channel policies, routing,
  classification review, private Slack answers, and transcript connectors;
- provider boundaries for Nango and asynchronous search;
- model receipts, budgets, idempotency, lifecycle fencing, and tenant-isolation
  checks.

The staging evidence already proves the transcript pipeline, cited retrieval,
workspace isolation, and temporary read-only CLI key path. That is real product
infrastructure, not a vector-database sketch.

## What It Does Not Yet Have

The current product is Slack- and transcript-first. It does not yet provide
production connectors and normalization contracts for:

- Google Drive and Google Docs;
- Gmail;
- Monday;
- DocuSign;
- a CRM;
- Notion;
- a team-wide Codex/Claude bootstrap package;
- a general write-capable agent tool plane.

Some generic capabilities and provider seams elsewhere in the template remain
fixtures. A visible screen or typed interface is not evidence that a source is
live.

## The Shared Context Model

Do not make a GitHub folder the live knowledge database. Use Git for the small
amount of context that should change through review:

```text
company-context/
  README.md
  glossary.md
  policies/
  brain-map.yaml
  source-policy.yaml
  agent-policy.yaml
  seeds/
```

This folder should contain vocabulary, source-routing policy, durable company
rules, bootstrap instructions, and optional seed pages. It must not contain
synced email, contracts, CRM exports, OAuth tokens, or copied Drive documents.

Live context belongs in the Brain source ledger:

1. A connector records an immutable provider observation.
2. A deterministic adapter normalizes it to a typed source unit.
3. Policy routes the unit to the company or client Brain.
4. A search projection makes active evidence retrievable.
5. A maintenance model may propose a change to a human-readable Brain page.
6. Review or an explicit autopilot policy commits a new cited page revision.
7. Every surface reads the same authorized retrieval/Ask capability.

That separation prevents the common failure where a polished summary silently
becomes more authoritative than the source that produced it.

## CRM, Company Context, And Tools

The three-part model is correct, with one refinement:

```text
operational state <-> evidence-backed context <-> agent execution
```

### Operational state

CRM, Monday, DocuSign, and similar applications remain systems of record.
Maestro stores stable references, selected searchable projections, sync
receipts, and citations. It should not become the primary deal pipeline, project
manager, or signature ledger.

Structured facts that agents regularly need should have typed projections—for
example account, opportunity stage, contract status, owner, renewal date, and
project health. Large bodies and history remain cited source evidence.

### Company context

The agency Brain holds ICP, positioning, economics, services, staff, process,
market, policies, and reusable operating knowledge. Client Brains remain hard
authorization and retrieval boundaries. A company-wide question may search the
agency Brain plus explicitly authorized client Brains; it must never achieve
that by dropping the Brain key from a query.

### Agent execution

Tool calling belongs with agents. Maestro Brain should publish read-oriented
context tools such as:

- `brain.search`
- `brain.ask`
- `brain.source.get`
- `brain.page.get`
- `brain.context.pack`

An agent runtime grants Gmail, Monday, CRM, DocuSign, browsing, or code tools
for a specific role or task. The Brain stores tool policy, capability metadata,
and audited receipts when useful, but it does not hold a universal credential
that lets every agent act everywhere.

Writes should flow through narrow capabilities with explicit scopes, idempotency
keys, confirmation requirements, and approval policy. Do not turn the existing
read-only Brain MCP key into an all-company write token.

## Retrieval And Vector Search

Do not begin by choosing a vector database. The repository already makes the
better foundational choices: exact sources, deterministic normalization,
workspace-scoped projections, citations, freshness, and lifecycle revocation.

Start with hybrid retrieval:

1. typed filters for tenant, source, account/client, status, owner, and time;
2. full-text search over active source/page projections;
3. recency and source-authority ranking;
4. semantic candidates only when evaluation shows a recall gap;
5. reranking and answer generation over a pinned candidate manifest.

If embeddings become useful, add them as a replaceable search adapter and
derived projection. They are never the canonical store, and deletion or access
revocation must remove them through the same lifecycle fence as every other
derived copy.

## Source Rollout

Add sources in value order, not connector-count order:

1. **Shared Drive** — high-signal operating docs and sales collateral; begin
   with selected shared drives/folders, not every user's Drive.
2. **CRM** — accounts, opportunities, stages, ownership, notes, and economics;
   keep the CRM authoritative.
3. **Monday** — selected boards and updates that describe delivery status.
4. **DocuSign** — envelope and agreement metadata first; ingest final signed
   documents only with an explicit retention and access policy.
5. **Gmail** — last, and only scoped mailboxes/labels or explicit forwarding.
   Company-wide mailbox ingestion creates the largest privacy, noise, and
   authorization burden.
6. **Notion** — only if material content still lives there; treat it as another
   source rather than the Brain's architecture.

For every connector require: source allowlist, stable provider identity,
incremental cursor, webhook/reconciliation strategy, immutable revision,
normalizer, routing policy, deletion propagation, permission mapping, health UI,
and a real-provider acceptance test.

## Team Environment

The team should share configuration, not a shared local chat transcript.

Each approved Codex/Claude environment gets:

- the same repository and reviewed `company-context/` policy folder;
- the same Maestro Brain MCP endpoint;
- a separate user- or agent-bound credential with least-privilege scopes;
- a standard `Ask Apero` skill that searches first, returns citations, states
  freshness, and abstains when evidence is insufficient;
- role-specific tool bundles installed separately from the Brain connection;
- audit and revocation without rotating one credential for the whole team.

The result replicates the useful part of “Ask Apero Advisors”—shared current
company context—without coupling that context to one Claude Project or giving
every coding session universal company-tool access.

## Pilot Decision Register

Four owner decisions are required before connector work begins:

1. Name one owner for agency context quality and one owner for connector and
   access policy. These may be the same person during the pilot, but the
   responsibilities remain distinct.
2. Select the authoritative CRM and an allowlist of Shared Drive folders for the
   first source cohort.
3. Select five pilot users and turn the recurring questions they currently ask
   in Claude Chat into a versioned evaluation set.
4. Choose the default policy for agent writes: always require confirmation,
   permit role-bound actions, or approve specific workflows. Read access does
   not imply write authority.

Do not use connector implementation to make these product and governance choices
implicitly.

## Evaluation Contract

Before the pilot, assign target values and owners for:

- answer coverage across the approved question set;
- citation correctness and source-authority selection;
- freshness lag by source type;
- required abstention when evidence is missing, stale, or unauthorized;
- cross-surface consistency across web, CLI, Slack, and MCP;
- tenant-leakage tests and credential-revocation time;
- connector reconciliation, deletion propagation, and health visibility.

The baseline is the current “Ask Apero Advisors” workflow. Maestro Brain should
replace it only when the pilot is at least as useful while being more current,
citable, revocable, and portable across agent runtimes.

## Recommended Delivery Sequence

### Phase 0 — Use what is already real

- Finish the canonical SaaS UI migration and deploy the current product.
- Confirm WorkOS users, agency/client switching, Brain editing, citations,
  search/Ask, read-only MCP, and key revocation in the real environment.
- Seed the six-page agency context structure and designate content owners.

### Phase 1 — Apero read path

- Add the reviewed `company-context/` policy folder.
- Add an `Ask Apero` MCP/skill package with citations and freshness.
- Issue individual read-only credentials to a small pilot group.
- Define an evaluation set from real questions currently asked in Claude Chat.

### Phase 2 — Highest-value sources

- Add Shared Drive and the chosen CRM through source-specific adapters.
- Add structured CRM projections without copying CRM workflow ownership.
- Measure answer coverage, citation quality, freshness lag, and abstention.

### Phase 3 — Delivery context

- Add selected Monday boards and DocuSign agreement metadata/documents.
- Add cross-source entity resolution through stable company/account IDs and
  reviewed aliases, not model-created identity joins.

### Phase 4 — Sensitive communications and actions

- Pilot narrow Gmail labels or forwarding addresses.
- Add agent-side write tools one workflow at a time with explicit approval and
  audit contracts.
- Add semantic retrieval only if the evaluation set demonstrates the need.

## Success Criteria

The company Brain is working when:

- a new teammate can ask the top recurring company questions from Codex or
  Claude Code and receive current cited answers;
- the same question receives materially the same evidence across web, CLI,
  Slack, and MCP;
- source edits and deletions propagate within a declared freshness window;
- client-private evidence never appears in an unauthorized company answer;
- the system abstains when evidence is missing or stale;
- every team or agent credential can be independently scoped and revoked;
- adding a source does not require redesigning the Brain or the agent runtime.
