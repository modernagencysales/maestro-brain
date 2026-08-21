# Apero Company Brain Implementation Plan

**Status:** proposed execution plan

**Date:** 2026-08-21

**Specification:**
[Apero Company Brain Product And Technical Specification](./apero-company-brain-spec.md)

**Architecture decision:**
[Apero Company Brain Architecture](./apero-company-brain-architecture.md)

## 1. Goal

Deliver a five-user Apero read pilot that replaces the recurring company-context
questions currently handled by the Claude “Ask Apero Advisors” project.

The pilot includes the reviewed company policy folder, separate user
credentials, the Ask Apero skill in Codex and Claude Code, current
Slack/transcript evidence, selected Shared Drive folders, one CRM, cited
retrieval, freshness, evaluation, health, and rollback.

Monday, DocuSign, Gmail, provider writes, and semantic retrieval remain
post-pilot unless a pilot dependency proves otherwise.

## 2. Execution Rules

- Preserve the existing Brain source ledger, authorization, lifecycle, and
  headless surfaces.
- Do not introduce a second company-context database.
- Exact source capture commits before model work.
- Provider adapters never own authorization or domain policy.
- A screen or typed interface is not evidence that a capability is real.
- Every source ships fake conformance fixtures and a real-provider acceptance
  receipt.
- Every work package closes its focused gates before integration.
- Run the broad delivery gate once on the integrated pilot candidate.
- Do not expose write tools during the read pilot.

The repository's `template:systems` command is not currently available despite
being named by the general agent instructions. This is recorded as a template
finding; it does not authorize a parallel system. Each package below names the
existing owner directly.

## 3. Classification Key

- `fixture-to-real`: replace a deterministic fixture body behind an existing
  contract while preserving or deliberately revising the contract.
- `pattern-instance`: use an existing `pnpm template:*` generator and complete
  its focused gates.
- `template-gap`: the required reviewed generator/pattern does not exist; name
  the missing pattern and proposed promotion path before implementation.

## 4. Delivery Shape

```text
owner decisions + evaluation set
              |
              v
product closure + real context pack
              |
              v
Ask Apero bootstrap + individual credentials
              |
              v
Shared Drive ------> CRM
              \      /
               v    v
              read pilot
                  |
        +---------+----------+
        v         v          v
      Monday   DocuSign    narrow Gmail
                  |
                  v
          approved write workflows
```

## 5. Milestones

| Milestone                                | Outcome                                                                  | Required packages |
| ---------------------------------------- | ------------------------------------------------------------------------ | ----------------- |
| M0 — Decisions frozen                    | Owners, CRM, Drive scope, users, evaluation, and thresholds approved     | WP00-WP01         |
| M1 — Existing product trusted            | Canonical UI, deployment, tenancy, lifecycle, and read surfaces verified | WP02              |
| M2 — Ask Apero works on current evidence | Real context pack, skill, MCP, credentials, citations, freshness         | WP03-WP05         |
| M3 — Highest-value sources live          | Selected Drive and CRM evidence available and reconciled                 | WP06-WP07         |
| M4 — Read pilot accepted                 | Five users pass evaluation and operational gates                         | WP08              |
| M5 — Context breadth expanded            | Monday and DocuSign accepted; Gmail remains policy-gated                 | WP09-WP11         |
| M6 — First safe action                   | One provider write workflow accepted with approval and audit             | WP12              |

## 6. Work Packages

### WP00 — Freeze Pilot Decisions

**Classification:** `template-gap`

**Missing pattern:** no generator owns a product decision register or source
governance packet. Promote the approved structure into the template only after
the Apero pilot proves it reusable.

**Dependencies:** none

**Outcome:** implementation has named owners and cannot make business or privacy
decisions implicitly.

**Deliverables:**

- context quality owner;
- connector/access owner;
- selected CRM provider;
- selected Shared Drive folder allowlist;
- five pilot users;
- source freshness targets;
- Gmail and signed-agreement retention decisions;
- default future write-approval posture;
- durable-sharing decision for the team brief.

**Files:**

- `docs/product/apero-company-brain-decisions.md`
- `company-context/source-policy.yaml` after WP03 scaffolds the folder

**Failure-first proof:** a decision validation test or checklist reports every
missing required owner choice.

**Exit gate:** every decision is approved, dated, and assigned; unresolved items
are explicit pilot exclusions.

**Commit:** `docs: freeze Apero Brain pilot decisions`

### WP01 — Build The Evaluation Baseline

**Classification:** `template-gap`

**Missing pattern:** no generator owns a cross-surface Brain evaluation corpus.
Proposed promotion path: Apero-local fixtures first, then a reusable
`template:add-brain-eval` only after the schema stabilizes.

**Dependencies:** WP00 pilot users and owners

**Outcome:** the current Claude workflow becomes a measurable baseline rather
than an anecdotal comparison.

**Deliverables:**

- 30-50 real recurring questions, redacted where required;
- allowed Brain scope for every question;
- required and forbidden evidence;
- source-authority expectation;
- freshness requirement;
- answer, citation, abstention, leakage, latency, and cost rubric;
- frozen numeric pilot thresholds;
- baseline assessment from the current Claude Project.

**Candidate files:**

- `tooling/evals/fixtures/apero-company-brain/`
- `tooling/evals/src/aperoCompanyBrain.ts`
- `docs/product/apero-company-brain-evaluation.md`

**Focused gates:**

- `pnpm --dir tooling/evals test`
- schema validation for every fixture;
- `pnpm check:secret-canaries`
- `git diff --check`

**Exit gate:** owners can reproduce the baseline without access to the original
conversation that created the dataset.

**Commit:** `test: add Apero company Brain baseline`

### WP02 — Close Product And Deployment Readiness

**Classification:** `template-gap`

**Missing pattern:** the transplanted canonical SaaS UI shelf needs its upstream
typecheck-baseline mechanism or a reviewed product-closure typecheck. The
existing broad TypeScript gate is red on Storybook, legacy route, and shelf
compatibility diagnostics even though product tests and builds pass.

**Dependencies:** none; may run with WP00-WP01

**Outcome:** the deployed product is demonstrably usable before new sources are
added.

**Deliverables:**

- reviewed canonical shelf typecheck strategy;
- green lint, product typecheck, tests, client build, and SSR build;
- real environment verification for WorkOS, agency/client switching, Brain
  editing, citations, search, Ask, API/CLI/MCP, key revocation, and source
  health;
- declared fake/real status for every visible product surface;
- rollback and deployment-isolation receipt.

**Existing anchors:**

- `docs/template/saas-ui-starter-files.json`
- `tooling/eslint-plugin-template/saas-ui-registry-receipt.mjs`
- `docs/superpowers/receipts/maestro-brain/staging-pilot-launch.md`
- `packages/convex/confect/brain/readApi.spec.ts`
- `packages/convex/confect/headless/apiKeys.*`

**Focused gates:**

- `pnpm check:format`
- `pnpm lint`
- reviewed web/product typecheck gate
- `pnpm --dir apps/web test`
- `pnpm --dir apps/web build`
- existing headless, tenancy, lifecycle, and staging smoke tests

**Exit gate:** M1 receipt names the deployed revision and proves each claimed
surface against real identity and backend configuration.

**Commit boundary:** separate commits for typecheck policy, product fixes, and
staging receipt.

### WP03 — Add The Reviewed Company Context Bootstrap

**Classification:** `template-gap`

**Missing pattern:** no generator owns the small reviewed Git policy layer.
Proposed promotion path: Apero-local `company-context/`, followed by a template
playbook if the structure survives the pilot.

**Dependencies:** WP00

**Outcome:** every approved agent starts with the same vocabulary, source map,
and policy without placing live provider data in Git.

**Deliverables:**

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

**Required tests:**

- schema and reference validation;
- no secrets or prohibited live data;
- every Brain alias resolves to a stable key;
- every source route has an owner and authority class;
- every agent policy names allowed Brain and tool scopes.

**Focused gates:**

- policy-schema tests;
- `pnpm check:secret-canaries`
- `pnpm check:docs-freshness`
- `git diff --check`

**Exit gate:** a fresh Codex or Claude Code environment can read the folder and
identify the correct Brain endpoint, skill, scope rules, and owner contacts
without shared chat history.

**Commit:** `feat: add Apero company context bootstrap`

### WP04 — Replace The Source-Grounded Brief Fixture

**Classification:** `fixture-to-real`

**Fixture:** `packages/convex/confect/capabilities/sourceGroundedBrief.impl.ts`

**Real boundary:** Brain read/retrieval functions, exact source revisions,
policy snapshots, model egress, and model receipts.

**Dependencies:** WP01 evaluation schema; WP02 product readiness

**Outcome:** the agent-facing context capability reads real authorized evidence
instead of synthesizing source markdown.

**Contract work:**

- preserve explicit workspace/Brain scope;
- change the minimum read role from `editor` to the reviewed read role if the
  public contract requires it;
- make the operation idempotent where it creates a receipt;
- return exact revision keys, authority, freshness, conflicts, and truncation;
- add stable public typed errors for stale scope, lifecycle revocation,
  insufficient evidence, and subsystem disablement;
- expose externally only after headless policy review.

**Test-first sequence:**

1. unauthorized and cross-Brain denial;
2. exact revision manifest and citation return;
3. deleted/lifecycle-revoked exclusion;
4. deterministic truncation and byte budget;
5. source conflict result;
6. idempotent duplicate request;
7. model receipt and policy snapshot;
8. no provider or model call before authorization.

**Focused gates:**

- `pnpm confect:codegen`
- `pnpm confect:manifest`
- `pnpm --dir packages/convex test source-grounded-brief`
- `pnpm --dir packages/convex test brain-pages-crud`
- `pnpm check:confect-contracts`
- `pnpm check:headless-surface-contract` after exposure

**Exit gate:** an evaluation fixture receives a real context pack whose claims
resolve to the exact authorized source/page revisions used.

**Commit:** `feat: read real evidence for context packs`

### WP05 — Ship The Ask Apero Skill And Individual Access

**Classification:** `template-gap`

**Missing pattern:** no repository generator owns a dual Codex/Claude company
skill bundle. Proposed promotion path: Apero skill plus installation docs, then
extract a reusable team-bootstrap pattern after pilot.

**Dependencies:** WP03-WP04

**Outcome:** each pilot user can ask the same question from Codex or Claude Code
with separate, revocable credentials.

**Deliverables:**

- Ask Apero skill instructions and prompt-injection policy;
- Codex and Claude Code installation/config templates;
- endpoint, scope, and credential bootstrap with secret names only;
- one user/agent-bound credential per installation;
- search-first, citations, freshness, conflict, and abstention behavior;
- credential inventory, expiry, rotation, and revocation runbook;
- cross-runtime contract test over the same fixtures.

**Existing anchors:**

- `packages/convex/confect/http.ts`
- `packages/convex/confect/manifest/mcp.ts`
- `packages/convex/confect/headless/apiKeys.*`
- `packages/convex/confect/brain/readApi.*`
- `apps/cli/bin/maestro-brain.mjs`

**Focused gates:**

- MCP initialize, tool list, tool call, and auth tests;
- key scope, expiry, role ceiling, and revocation tests;
- prompt injection and unsupported write refusal fixtures;
- Codex/Claude evidence-parity test;
- `pnpm check:headless-surface-contract`

**Exit gate:** five independent pilot identities answer the baseline questions
from both runtimes; revoking one identity does not affect the others.

**Commit boundary:** capability exposure, skill bundle, and operational docs are
separate intentions.

### WP06 — Add The Shared Drive Source

**Classification:** `template-gap`

**Missing pattern:** `template:add-source-type` does not exist. Follow
`docs/template/how-to-add-source-type.md`, implement the smallest source
contract directly, and record the missing generator in the template backlog.

**Dependencies:** WP00 Drive allowlist; WP02; WP04

**Outcome:** selected Drive documents are current, cited, reconcilable, and
deletable in the agency Brain.

**Candidate boundaries:**

- `packages/integrations/src/googleDrive/` for provider adapters and conformance
  fixtures;
- `packages/convex/confect/integrations/drive*.spec.ts` and `.impl.ts` for
  authenticated operations;
- existing source tables and source-processing jobs for persistence;
- Connections UI adapter for allowlist, health, cursor, and retry state.

**Required behavior:**

- connection and folder discovery;
- explicit folder allowlist;
- incremental sync plus full reconciliation;
- stable file and revision identity;
- deterministic Google Docs normalization;
- permission snapshot and access loss;
- move, unshare, trash, delete, and tombstone;
- metadata-only behavior for unsupported binaries;
- lifecycle propagation into search and context packs.

**Focused gates:**

- `pnpm --dir packages/integrations test`
- Drive normalizer and conformance fixtures;
- `pnpm --dir packages/convex test source-intake-storage`
- workspace-isolation and lifecycle tests;
- `pnpm check:schema-migration-notes`
- `pnpm check:secret-canaries`
- real-provider acceptance against a dedicated test folder

**Exit gate:** create, edit, move, unshare, and delete fixtures reconcile to the
expected exact revisions and freshness state.

**Commit boundary:** adapter, persistence/normalization, UI/health, and provider
receipt remain separate.

### WP07 — Add The Selected CRM Source

**Classification:** `template-gap`

**Missing pattern:** no source-type generator and no CRM projection pattern.
Implement only after WP00 names the provider; promote a generic projection
pattern only after the first provider passes acceptance.

**Dependencies:** WP00 CRM decision; WP04; WP06 source pattern findings

**Outcome:** Apero account and opportunity state is typed, current, cited, and
subordinate to the CRM as system of record.

**Typed projections:**

- account and contact stable identity;
- opportunity, stage, owner, amount/economics, next step, renewal date, and last
  activity when supported;
- source authority and observed-at metadata;
- notes as source evidence rather than untyped projection fields.

**Required tests:**

- provider pagination and incremental cursor;
- field mapping and unknown/custom fields;
- account/client Brain routing;
- duplicate/merged records;
- deletion and access loss;
- stale stage conflict with Brain page summary;
- cross-client isolation;
- no CRM write SDK call in the read connector.

**Focused gates:** same source, lifecycle, schema, isolation, secret, and
real-provider gates as WP06, plus projection contract tests.

**Exit gate:** the evaluation set can answer approved account/economics
questions with exact CRM authority and freshness.

**Commit:** provider-specific intentions; no premature generic CRM framework.

### WP08 — Run And Accept The Read Pilot

**Classification:** `template-gap`

**Missing pattern:** no generator owns an Apero-specific evaluated rollout.

**Dependencies:** WP01-WP07

**Outcome:** owners decide from evidence whether Maestro Brain can replace the
current Claude Project for pilot questions.

**Execution:**

1. freeze deployed revision and policy epoch;
2. issue five individual credentials;
3. run the versioned evaluation in web, Codex, Claude Code, CLI, and MCP;
4. run isolation, deletion, revocation, stale-source, and connector-failure
   drills;
5. review misses and fix only against a new evaluation revision;
6. rerun the complete candidate once;
7. sign accept, extend, or rollback decision.

**Required receipt:**

- source and deployment revisions;
- evaluation dataset version;
- redacted metric results;
- connector freshness and health;
- isolation and revocation results;
- known limitations;
- owner decision and rollback status.

**Broad gate:** run the repository delivery gate on the immutable candidate head
after focused gates pass. Buildkite/GitHub and local commands remain the verdict
authorities available to this repository.

**Exit gate:** M4 acceptance criteria in the specification pass, or the pilot
rolls back without losing audit evidence.

**Commit:** `docs: record Apero Brain pilot verdict`

### WP09 — Add Selected Monday Boards

**Classification:** `template-gap`

**Dependencies:** successful WP08; owner-selected boards

**Outcome:** delivery state becomes available as typed, cited context while
Monday retains workflow authority.

**Scope:** board/item/group identity, owner, status, due date, selected columns,
and update evidence. No universal column mirror.

**Gates:** source conformance, board allowlist, pagination/cursor,
reconciliation, deletion, permission loss, lifecycle, isolation, UI health, and
real-provider acceptance.

**Exit gate:** selected delivery questions pass without importing unrelated
boards or making the Brain a project manager.

### WP10 — Add DocuSign Metadata And Approved Agreements

**Classification:** `template-gap`

**Dependencies:** successful WP08; signed-agreement retention decision

**Outcome:** agreement status is queryable without broad document exposure.

**Sequence:**

1. envelope/party/status/timestamp metadata;
2. permission and client routing;
3. retention and deletion proof;
4. only then final signed document ingestion for approved classes.

**Gates:** metadata/document access separation, retention, confidentiality,
revocation, lifecycle, cross-client isolation, and real-provider acceptance.

**Exit gate:** a user who may see envelope status but not the document cannot
retrieve document evidence through search, Ask, API, or MCP.

### WP11 — Pilot Narrow Gmail Evidence

**Classification:** `template-gap`

**Dependencies:** successful WP08; explicit mailbox/label and retention policy

**Outcome:** only approved communication evidence enters the Brain.

**Scope:** named labels, mailboxes, or forwarding addresses; thread/message
identity; sender/recipient metadata; timestamps; approved bodies; strict
redaction and retention.

**Gates:** allowlist denial, personal-mail exclusion, sensitive fixture
redaction, thread edits/deletion, permission loss, lifecycle propagation,
isolation, and real-provider acceptance.

**Exit gate:** an unrestricted mailbox crawl is structurally impossible under
the pilot configuration.

### WP12 — Add The First Write-Capable Agent Workflow

**Classification:** `pattern-instance`

**Generators:**

```bash
pnpm template:add-capability -- --name <approvedAction> --description "<owner-approved action>" --write
pnpm template:add-agent -- --name <approvedAgent> --write
```

Use `template:promote-capability` only after review of the generated draft and
provider boundary.

**Dependencies:** successful WP08 and a separately approved action decision

**Outcome:** one narrow provider action works with explicit scope, confirmation,
idempotency, receipt, reconciliation, and revocation.

**Non-goals:** no general write MCP, no universal agent, and no implicit write
authority from read credentials.

**Required tests:**

- tool grant acceptance and refusal;
- unauthenticated, role, and cross-workspace denial;
- confirmation required before provider call;
- idempotent duplicate submission;
- ambiguous provider response and reconciliation;
- prompt injection refusal;
- audit redaction;
- credential revocation;
- safe retry and operator recovery.

**Focused gates:**

- `pnpm confect:codegen`
- `pnpm confect:manifest`
- generated capability and agent tests;
- `pnpm check:confect-contracts`
- `pnpm check:headless-surface-contract` if exposed;
- provider conformance and real-provider acceptance

**Exit gate:** only the approved workflow, principal, provider, and operation
can act; every attempt is explainable and recoverable.

## 7. Optional Semantic Retrieval Decision

Semantic retrieval is not a scheduled work package. After WP08, inspect
evaluation misses and classify them:

- missing source;
- stale source;
- normalization failure;
- permission/routing failure;
- lexical retrieval failure;
- answer/reranking failure.

Only lexical retrieval failures authorize a semantic-search proposal. That
proposal must retain the exact source ledger as authority, use a replaceable
adapter under `packages/search`, lifecycle-fence every embedding, and rerun the
same evaluation set against cost, latency, recall, and leakage.

## 8. Critical Path

The shortest path to a useful decision is:

```text
WP00 decisions
  -> WP01 evaluation
  -> WP02 readiness
  -> WP03 bootstrap
  -> WP04 real context pack
  -> WP05 Ask Apero
  -> WP06 Drive
  -> WP07 CRM
  -> WP08 pilot verdict
```

WP00-WP02 may overlap. WP03 may begin after the decision schema is stable. WP06
and WP07 may overlap only after WP04 freezes the shared source and context
contracts. WP09-WP12 do not block the read pilot.

## 9. Suggested Sequence

Indicative sequence, not a staffing or date commitment:

| Window | Focus                               | Demonstrable outcome                                                  |
| ------ | ----------------------------------- | --------------------------------------------------------------------- |
| 1      | decisions, baseline, readiness      | approved scope and reproducible current-state evaluation              |
| 2      | bootstrap, real context pack, skill | Ask Apero answers current Slack/transcript questions in both runtimes |
| 3      | Shared Drive                        | selected documents sync, cite, update, and delete correctly           |
| 4      | CRM                                 | approved structured company/economic questions use CRM authority      |
| 5      | pilot                               | five users complete the frozen evaluation and drills                  |
| later  | Monday, DocuSign, Gmail             | context breadth expands behind source-specific gates                  |
| later  | first provider action               | one approved write workflow, not a generic tool plane                 |

## 10. First Ten Actions

1. Approve WP00 owners, CRM, Drive scope, users, and policy decisions.
2. Export the recurring Ask Apero questions and build WP01 fixtures.
3. Select and document the web shelf typecheck strategy in WP02.
4. Verify the current deployed Brain read path and credential revocation.
5. Create the `company-context/` policy skeleton with no live provider data.
6. Write failure-first tests for real `sourceGroundedBrief` retrieval.
7. Replace synthetic source markdown with exact authorized revisions.
8. Package Ask Apero for Codex and Claude Code with individual credentials.
9. Connect one dedicated Drive test folder and pass lifecycle conformance.
10. Begin the selected CRM adapter only after its projection mapping is
    reviewed.

## 11. Release Decision

At WP08, owners choose one of three outcomes:

- **Accept:** Maestro Brain replaces the Claude Project for the approved pilot
  question set and proceeds to source expansion.
- **Extend:** keep both systems temporarily, name exact failing metrics, and run
  one bounded remediation cycle against a new candidate.
- **Rollback:** revoke pilot credentials, disable new connector delivery,
  preserve audit evidence under retention policy, and return to the previous
  workflow.

“The demo looked good” is not an acceptance state.
