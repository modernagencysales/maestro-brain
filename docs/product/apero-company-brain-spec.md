# Apero Company Brain Product And Technical Specification

**Status:** proposed pilot specification

**Date:** 2026-08-21

**Architecture decision:**
[Apero Company Brain Architecture](./apero-company-brain-architecture.md)

**Delivery plan:**
[Apero Company Brain Implementation Plan](./apero-company-brain-implementation-plan.md)

## 1. Product Definition

Apero Company Brain is the shared context plane used by people and agents across
Codex, Claude Code, the Maestro web app, Slack, CLI, API, and MCP.

It connects approved systems of record, preserves exact source evidence,
normalizes that evidence into permission-scoped source units, maintains
human-readable company and client context, and returns current answers with
citations and freshness.

It is not:

- the CRM, document store, project manager, signature ledger, or mailbox;
- a shared chat transcript or a replacement for local agent runtimes;
- a universal credential broker that lets every agent act in every provider;
- a vector database as the canonical source of company truth;
- an automatic cross-client knowledge graph.

The operating model is:

```text
systems of record              context plane                 agent runtimes
-----------------              -------------                 --------------
Drive / CRM / Monday           exact observations            Codex / Claude Code
DocuSign / Gmail      ------>  normalized source units  ---> Ask Apero skill
Slack / calls                  curated Brain pages           role-specific tools
Notion when needed             citations + revisions         approved write actions
                               search + Ask + MCP
```

## 2. Product Goal

Replace the useful part of the Claude “Ask Apero Advisors” project with a
shared, current, cited, revocable context service that works in any approved
agent runtime.

The pilot succeeds when a selected teammate can open Codex or Claude Code, run
the same Ask Apero workflow, and receive an answer that is at least as useful as
the current Claude Project while being:

- grounded in exact evidence;
- current within a declared source-specific freshness window;
- consistent across supported surfaces;
- scoped to the caller's agency and client permissions;
- independently auditable and revocable;
- portable between Codex and Claude Code.

## 3. Users And Jobs

### 3.1 Company teammate

Needs reliable answers about Apero's ICP, offers, positioning, economics,
people, policies, process, active clients, and market without manually finding
the latest source document.

### 3.2 Client operator

Needs agency context plus the client Brains they are authorized to access. A
company-wide query must not expose a client merely because the user belongs to
the agency.

### 3.3 Context owner

Owns readable Brain quality, reviews proposed changes, resolves conflicting
sources, sets source authority, and monitors stale or uncited knowledge.

### 3.4 Connector and access owner

Approves provider scopes, source allowlists, retention, deletion, health,
credential issuance, and incident response.

### 3.5 Agent runtime

Receives a separate service identity and a minimal set of context and action
tools for a declared role or workflow. It never inherits a human's complete
provider access by default.

## 4. Scope

### 4.1 Pilot scope

- one Apero organization and agency Brain;
- existing client Brains remain separate retrieval boundaries;
- a reviewed `company-context/` bootstrap and policy folder;
- one Ask Apero skill that works in Codex and Claude Code;
- individual read-only Brain credentials for five pilot users;
- current Slack and transcript evidence;
- selected Shared Drive folders;
- one selected CRM with typed account and opportunity projections;
- a versioned evaluation set based on real Ask Apero questions;
- web health and source-freshness visibility;
- no broad agent write authority.

### 4.2 Post-pilot scope

- selected Monday boards;
- DocuSign envelope metadata and policy-approved signed agreements;
- narrow Gmail labels, mailboxes, or forwarding addresses;
- Notion only for material sources that remain there;
- one approved write workflow at a time;
- optional semantic retrieval when evaluation demonstrates a recall gap.

### 4.3 Explicitly excluded

- crawling every user's Drive or mailbox;
- replacing provider-native workflows;
- automatically copying all client context into the agency Brain;
- silent model-authored page changes;
- cross-source identity joins accepted only because a model proposed them;
- one shared API key for the whole team;
- general-purpose write-capable MCP;
- semantic search without a measured retrieval need.

## 5. Existing Product Baseline

The following are real repository capabilities and must be extended rather than
reimplemented:

- WorkOS organization and agency/client Brain tenancy;
- `viewer | editor | admin | owner` role ordering;
- stable keys and workspace-scoped authorization;
- Brain page trees, immutable revisions, citations, review, restore, and
  deterministic export;
- exact source tables for sources, artifacts, units, revisions, segments,
  processing jobs, and connector sync states;
- Slack/Nango connection, channel policy, capture, routing, and private answer
  paths;
- transcript provider normalization and sync;
- workspace-scoped search and cited Ask contracts;
- API keys, CLI, stateless MCP transport, and headless operation policy;
- lifecycle fencing, audit events, model receipts, and idempotency patterns.

The following are not yet production capabilities:

- Drive, CRM, Monday, DocuSign, Gmail, and Notion connectors;
- team environment bootstrap and the Ask Apero skill package;
- a general context-pack operation shaped for agent use;
- write-capable provider actions;
- semantic retrieval as a proven production dependency.

The existing `capabilities.sourceGroundedBrief` implementation is a contract
fixture. It authorizes an editor, synthesizes source content, and calls a fake
runner. The pilot must not treat that fixture as a live context capability.

## 6. Source Of Truth And Authority

### 6.1 Authority rules

Every retrievable fact has an authority class:

| Context                             | Authoritative system                       | Brain responsibility                                   |
| ----------------------------------- | ------------------------------------------ | ------------------------------------------------------ |
| Company policy and vocabulary       | reviewed Git policy or approved Brain page | preserve revision and owner                            |
| Sales collateral and operating docs | selected Shared Drive source               | capture revision and citation                          |
| Account and opportunity state       | CRM                                        | store typed projection and source reference            |
| Delivery status                     | selected Monday board                      | store selected status projection and updates           |
| Agreement status                    | DocuSign                                   | store envelope metadata and approved document evidence |
| Communication evidence              | approved Gmail scope                       | preserve message/thread evidence under policy          |
| Slack conversation                  | Slack                                      | preserve exact authorized observations                 |
| Call evidence                       | transcript provider                        | preserve canonical call and segments                   |
| Human-readable summary              | Brain page                                 | remain cited and subordinate to source evidence        |

When sources disagree, the answer must expose the conflict or follow an explicit
source-authority policy. It must not silently select the most fluent or most
recent text.

### 6.2 Git bootstrap boundary

The repository may contain:

```text
company-context/
  README.md
  glossary.md
  brain-map.yaml
  source-policy.yaml
  agent-policy.yaml
  policies/
  seeds/
  skills/ask-apero/
```

It must not contain synced provider bodies, mailbox exports, signed contracts,
OAuth material, API keys, or live customer records.

### 6.3 Live evidence boundary

Live provider data belongs in the Brain source ledger. Each provider observation
is immutable, addressable by stable provider identity, and linked to a lifecycle
generation. Search indexes, context packs, summaries, and embeddings are derived
projections and must honor deletion and revocation.

## 7. Canonical Connector Contract

Each source connector implements the same lifecycle:

```text
authorize -> discover -> allowlist -> observe -> normalize -> route
          -> project -> reconcile -> tombstone/purge -> attest health
```

### 7.1 Required connector inputs

- organization and connection stable keys;
- provider connection generation;
- approved source/container allowlist;
- incremental cursor or reconciliation checkpoint;
- provider object and revision identity;
- policy epoch and retention class;
- authenticated principal and requested operation.

### 7.2 Required connector outputs

- immutable observation receipt;
- canonical source unit and revision;
- normalized segments or structured projection;
- exact provider locator or permalink when allowed;
- source timestamp and ingestion timestamp;
- lifecycle and permission snapshot;
- idempotency/effect key;
- sync cursor and health result;
- tombstone or purge result for removals.

### 7.3 Required connector behavior

- Provider SDK imports stay inside the integration adapter boundary.
- OAuth/token storage is delegated to the approved connection provider.
- A provider object is ingested only when its container is allowlisted.
- Incremental sync is at-least-once; deterministic commit is idempotent.
- Webhooks never replace reconciliation.
- Permission loss stops future reads and revokes affected projections.
- Provider deletion produces a lifecycle transition, not a silent absence.
- Raw provider payloads and credentials are never logged.
- Every connector has fake fixtures plus a real-provider acceptance test.

## 8. Source-Specific Requirements

### 8.1 Shared Drive

- Select shared drives and folders explicitly.
- Preserve file ID, revision/version identity, MIME type, owners, modified time,
  permissions snapshot, and canonical link.
- Normalize Google Docs text and headings deterministically.
- Record binary files as metadata-only until an approved extraction path exists.
- Treat moved, unshared, trashed, and deleted files as lifecycle events.
- Do not ingest personal My Drive by default.

### 8.2 CRM

- The CRM selection is an owner decision before implementation.
- Define typed projections for account, contact, opportunity, stage, owner,
  amount/economics, next step, renewal date, and last activity when supported.
- Keep pipeline writes and workflow ownership in the CRM.
- Preserve provider-native IDs and source links on every projection.
- Store notes or long bodies as cited evidence, not untyped columns.

### 8.3 Monday

- Select boards explicitly.
- Normalize board, item, group, owner, status, due date, and update evidence.
- Do not mirror every board column without a declared use.
- Keep Monday as the delivery workflow authority.

### 8.4 DocuSign

- Ingest envelope identity, parties, status, timestamps, and agreement metadata
  first.
- Ingest a signed document only when retention, confidentiality, and client
  routing policy allow it.
- Never expose a document because the envelope metadata is visible.

### 8.5 Gmail

- Start with named labels, mailboxes, or forwarding addresses.
- Exclude personal mail and unrestricted historical crawl.
- Preserve thread/message identity, sender/recipient metadata, timestamps, and
  approved body evidence.
- Apply stricter retention, redaction, and access policy than general docs.

### 8.6 Notion

- Add only when material company knowledge still lives there after Drive
  rollout.
- Treat Notion as another provider source, not as the Brain's data model.

## 9. Retrieval Specification

### 9.1 Retrieval stages

1. Resolve the authenticated principal and allowed Brains.
2. Parse explicit scope, source type, entity, owner, status, and time filters.
3. Retrieve active full-text and typed projection candidates.
4. Apply source authority, recency, lifecycle, and permission ranking.
5. Pin a candidate manifest with exact revision keys.
6. Optionally rerank the authorized candidate set.
7. Generate or return an answer over the pinned manifest.
8. Return citations, freshness, scope, and abstention/conflict state.

### 9.2 Retrieval invariants

- Every query has an explicit Brain set; no query means “all Brains.”
- A caller cannot expand scope with a prompt or model-selected Brain key.
- Deleted, purged, or lifecycle-revoked evidence is not retrievable.
- Search result excerpts are linked to exact source/page revisions.
- Semantic indexes, when present, are tenant- and lifecycle-scoped derived data.
- The answer model receives only the authorized candidate manifest.

### 9.3 Ranking order

The initial ranking signal order is:

1. authorization and lifecycle eligibility;
2. explicit structured filters;
3. source authority;
4. full-text match;
5. freshness/recency;
6. reviewed Brain-page relevance;
7. optional semantic score;
8. optional reranker score.

Semantic score must not override authorization, lifecycle, or explicit source
authority.

## 10. Ask Apero Contract

### 10.1 User behavior

The Ask Apero skill must:

1. resolve or ask for the intended company/client scope;
2. search before answering;
3. use Brain page and source evidence together;
4. cite claims with stable locators;
5. state freshness and relevant source conflicts;
6. abstain when evidence is insufficient or unauthorized;
7. distinguish retrieved evidence from agent inference;
8. never invoke provider write tools as part of a read request.

### 10.2 Context response shape

The agent-facing context-pack operation should return:

```ts
type ContextPack = {
  requestId: string;
  organizationKey: string;
  brainKeys: string[];
  question: string;
  asOf: number;
  freshness: Array<{
    sourceType: string;
    status: "current" | "stale" | "unknown";
    observedAt?: number;
  }>;
  entries: Array<{
    kind: "source" | "page" | "projection";
    title: string;
    excerpt: string;
    sourceKey: string;
    revisionKey: string;
    locator?: string;
    authority: string;
  }>;
  conflicts: Array<{
    subject: string;
    revisionKeys: string[];
  }>;
  limits: {
    truncated: boolean;
    maxBytes: number;
  };
};
```

The exact Effect schema and public error set are implementation artifacts. The
behavioral contract above is stable for the pilot.

### 10.3 Supported Brain tools

The read-oriented external surface is:

- `brain.sources.search`
- `brain.sources.get`
- `brain.pages.list`
- `brain.pages.get`
- `brain.context.get` or its reviewed context-pack successor
- `brain.answers.ask`

Operations remain one-Brain-scoped until a separately reviewed multi-Brain
selector proves authorization for every requested Brain.

## 11. Identity, Credentials, And Tool Policy

### 11.1 Human credentials

- Each teammate authenticates through the existing human identity path.
- Brain membership and role determine access.
- A user may receive an individual headless credential with a role ceiling and
  explicit scopes.

### 11.2 Agent credentials

- Every installed agent/runtime receives a separate service identity.
- Credentials are independently scoped, rotated, expired, and revoked.
- Credentials are never committed to `company-context/`.
- A credential identifies its intended surface and audience.

### 11.3 Tool grants

Tool bundles belong to the agent runtime. The Brain may store policy metadata
and action receipts, but it does not expose provider credentials to models.

Read grants and write grants are separate. A write-capable tool requires:

- a typed capability contract;
- explicit provider and operation scope;
- authenticated principal and role check;
- idempotency key;
- preview or confirmation policy;
- complete provider response normalization;
- audit receipt without raw sensitive payloads;
- safe retry and reconciliation behavior.

## 12. Brain Maintenance

- Exact sources are committed before model work.
- A maintenance model may propose a cited page revision.
- Review-first is the default.
- Autopilot, if enabled later, is page- and source-policy-specific.
- A proposal pins the source revision manifest and policy epoch used.
- A committed page revision records citations and its model receipt.
- Restore creates a new revision; history is never rewritten.
- A summary cannot make its supporting source inaccessible to an authorized
  reviewer.

## 13. Security And Privacy

### 13.1 Non-negotiable controls

- Organization and Brain authorization is server-side.
- Client-private context never enters an agency answer without an explicit
  client Brain grant.
- Provider connection generation and lifecycle generation fence stale work.
- Raw OAuth tokens, provider payloads, emails, contracts, and source bodies are
  excluded from logs and receipts.
- Prompt text cannot expand source allowlists, Brain scope, or provider tools.
- Deletion propagates to search, context packs, caches, and semantic indexes.
- Gmail and signed agreements receive explicit retention classifications.

### 13.2 Threat cases

Acceptance includes:

- cross-organization and cross-Brain read attempts;
- caller-supplied Brain key escalation;
- prompt injection inside retrieved documents;
- revoked credential use;
- connector permission loss during sync;
- deletion while processing is leased;
- duplicate webhook and reconciliation events;
- stale model completion after policy or lifecycle change;
- provider action retry after an ambiguous response.

## 14. Freshness, Health, And Operations

Each connector reports:

- last successful observation and reconciliation;
- cursor/checkpoint age;
- source allowlist count;
- pending, leased, failed, and dead-letter job counts;
- permission or credential failure class;
- lifecycle backlog;
- declared freshness status;
- last real-provider acceptance receipt version.

Freshness thresholds are source-specific owner decisions. The UI and Ask Apero
must not convert `unknown` or `stale` into `current`.

## 15. Evaluation Contract

The evaluation dataset contains versioned, owner-reviewed questions with:

- allowed Brain scope;
- required and forbidden evidence;
- expected source-authority class;
- maximum acceptable freshness;
- whether abstention is required;
- sensitive leakage fixtures;
- a reference assessment from the current Claude workflow.

Pilot reporting measures:

- answer usefulness against the current workflow;
- evidence recall and citation correctness;
- source-authority correctness;
- freshness compliance;
- abstention precision;
- cross-surface evidence consistency;
- tenant isolation and leakage failures;
- credential revocation propagation;
- connector reconciliation and deletion propagation;
- median and tail retrieval latency;
- cost per evaluated answer.

Owners set numeric thresholds before pilot execution. Thresholds are not chosen
after seeing the results.

## 16. Rollout And Exit Criteria

### 16.1 Internal read pilot

- five named users;
- separate credentials;
- company policy, Slack/transcripts, Drive, and CRM evidence;
- no broad provider write actions;
- daily connector health review during the initial pilot;
- versioned evaluation run before and after each retrieval change.

### 16.2 Pilot exit

The pilot exits successfully when:

- the agreed evaluation thresholds pass;
- no cross-tenant or unauthorized client evidence is observed;
- credentials can be independently revoked within the declared target;
- Drive and CRM edits/deletions propagate within their declared windows;
- citations resolve to the exact revision used;
- Ask Apero behaves consistently in Codex and Claude Code;
- owners accept the operational burden and incident path;
- the current Claude Project is no longer required for pilot questions.

### 16.3 Rollback

Rollback disables external delivery and connector sync without deleting source
history. It revokes pilot credentials, preserves audited evidence under the
retention policy, and restores the previous approved team workflow. A connector
may be disabled independently from the Brain read path.

## 17. Required Owner Decisions

Implementation cannot silently decide:

1. the agency context owner;
2. the connector and access owner;
3. the CRM provider;
4. the first Shared Drive folder allowlist;
5. the five pilot users;
6. the evaluation questions and numeric thresholds;
7. the source-specific freshness targets;
8. Gmail and signed-agreement retention policy;
9. the default approval rule for future provider writes;
10. whether the Quarry brief remains Tailscale-only or receives a durable
    authenticated deployment.

## 18. Product Acceptance Summary

A release is not accepted because a connector authenticates, a screen renders,
or a model produces a good answer once. Acceptance requires:

- exact and repeatable source capture;
- stable, cited, permission-scoped retrieval;
- deletion and revocation propagation;
- real-provider conformance;
- cross-surface consistency;
- owner-approved evaluation results;
- a documented rollback path.
