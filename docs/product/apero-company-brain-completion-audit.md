# Apero Company Brain Completion Audit

**Status:** current-state audit; not a completion claim

**Audited base:** `1ab2c6f589db81eadba6c98d3fe813e43911df34`; live activation
evidence is recorded in `docs/product/apero-company-brain-live-activation.md`

**Date:** 2026-08-29

## 2026-08-29 local readiness update

### Durable extraction activation and progressive evaluation

Merge `47a9243b` is deployed to staging through GitHub deployment `6159400887`
and Woodpecker deployment pipeline `296`. The Apero workspace now runs the live
extractor behind a $5/day workspace spend ceiling and the workspace rollout
flag. Extraction policy `brain-extractor-v2` rejects generic advice, chatter,
tool mechanics, isolated preferences, and contextless fragments. It accepts a
single whole-message JSON code fence from otherwise valid provider output while
remaining fail-closed on prose or schema drift. The live 101-item Slack corpus,
the operational Start Here page, and low-value release receipts produced no
durable candidates under v2; seven previously low-value proposals were rejected
explicitly, nothing was auto-promoted, and the review queue is empty.

The merged and guarded staging release closes the engineering gap between
`--save-example` and an operable evaluation lifecycle. CLI `0.1.8` adds bounded
status/list/show, exact-reference adjudication, deterministic redacted export,
time- and source-separated freeze preview/apply, and reproducible reruns through
canonical `brain.ask`. The backend keeps observed output separate from expected
support, hides frozen labels from ordinary and MCP reads, and makes holdout
labels immutable. Every report includes exact denominators and explicitly marks
citation entailment `not-assessed`; an empty or one-example real ledger remains
`insufficient-sample`. This is engineering readiness, not a frozen real Apero
set or completed replacement pilot.

Merge `b8546396` passed required PR pipeline `297` and deployed through GitHub
deployment `6161460093` and guarded Woodpecker pipeline `299`. Live CLI and HTTP
MCP receipts are recorded in the activation document. The live ledger still has
one pending development example and no adjudicated or holdout examples, so the
real evaluation maturity remains `insufficient-sample`.

### Release hardening after cold review

The subsequent release audit found and fixed four data-flow defects before
teammate rollout: Drive metadata-only and capacity-exceeded objects are no
longer projected as searchable evidence; every recent-evidence search result is
reopened against its immutable revision and current source before inclusion;
completed connector traversals retire prior provider scopes; and reviewed claims
now use the same grounded stop-word and coverage threshold as evidence
retrieval. The live 101-source Slack corpus also exposed an extraction admission
bound of 100; the bound now matches the declared 1,000-source connector ceiling
and is covered by a 101-source regression test.

Terminal release `0.1.8` is live. It retains the onboarding and grounded-Ask
improvements from `0.1.7` and adds the progressive evaluation lifecycle. The
setup flow safely upgrades older CLI-managed Ask Apero skills and moves the
skill onto canonical `brain.ask` ContextPack V4, renders a concise cited answer
by default with `--json` retaining the wire response, distinguishes common
failure classes by exit code, and rejects an oversized active review request
locally instead of surfacing a generic MCP error. It also makes setup reruns
safely merge the managed Codex MCP block and adds compact page-history
inspection. The Brain source rail groups and filters synced evidence and bounds
the initially visible Slack list.

The merged V4 application is deployed to staging (GitHub deployment
`6157621095`, Worker version `3820ba92-29a3-4ccd-b61d-e3a0bc9eefd3`) and its
16-tool MCP catalog, CLI doctor, cited Ask response, page
create/update/search/reopen/history flow, and extraction run have live receipts.
Google Drive activation, a fresh teammate acceptance receipt, Claude/Cowork
identity comparison, the frozen real evaluation set, and the elapsed replacement
pilot remain open human/live gates.

The core V4 engineering pass is merged and deployed, but the V1 definition of
done remains open. Three independent cold reviews agreed that the product must
not be called pilot-complete without real Slack/Drive evidence, a frozen
evaluation set, cross-runtime live identity checks, and the elapsed Apero
replacement pilot.

Since the prior checkpoint, the local product path gained exact immutable web
citation reopening, visible ContextPack identity/conflicts/omissions, explicit
web evaluation capture, bounded five-item review with edit/bulk reject,
reviewer-selected freshness horizons, accepted-claim copy-for-Page, terminal
candidate review and exact evidence reopening, configurable narrow Slack sync,
bounded rate-limit retry, and claim review-due propagation on source withdrawal.
The release verification passed Convex tests, required runtime acceptance,
typecheck, production build, generated-file checks, Confect manifest, headless
contract, and lint with zero errors. Staging now exposes all 16 MCP tools,
including `brain.ask`, knowledge review, exact evidence reopening, and page
history.

Read-only staging verification originally found 101 active Slack sources. A
fresh complete single-channel reconciliation after merge `1ab2c6f5` now reports
99 active sources and 99 current entries, with current-index coverage and no
capacity finding. A Slack search result reopened the exact immutable
source/revision/content-hash tuple without exposing its body in this receipt. A
real Codex process and the CLI returned the same ContextPack hash and ordered
citation identities for the same Apero question; Claude Code reached its local
login boundary and remains an open human receipt. Google Drive remains empty.
These live facts advance V1A but do not prove the required Slack edit/removal
lifecycle, Drive vertical, cross-runtime V4 identity parity, or replacement
pilot.

### CLI 0.1.9 onboarding and connector-contract release

Merge `1ab2c6f5` passed required pull-request pipeline `302` and deployed
through GitHub staging deployment `6162343742` and guarded Woodpecker pipeline
`304`. Release `brain-cli-v0.1.9` is bound to the merge SHA; its public
`maestro-brain.tgz` asset has SHA-256
`d4ef6947afddb81e6f9db0580dc031d6ab7c4f2284fb810c917181c701922eb1`.

The public asset installed as CLI `0.1.9`. A clean project setup created exact
Codex, Claude Code, Cowork, and Ask Apero descriptors, and authenticated doctor
passed API, MCP protocol, MCP tools, workspace evidence, and descriptor checks.
Live OpenAPI is 3.1.0 with 20 paths. HTTP MCP advertises 15 tools, contains
`template.brain.ask`, and no longer advertises
`template.agents.assistant.answerQuestion`. A mixed V4 question returned schema
`4`, effective mode `mixed`, and an exact Slack citation.

The bounded scheduled Slack action then completed against the stored approved
single-channel scope and generation, indexing 99 current messages in one page.
The connection remains active/ready with scheduled reconciliation enabled, and
evidence health reports current-index coverage. The count change from 101 to 99
is the result of a fresh complete provider traversal, not a forced historical
count. Drive and HubSpot remain at zero active sources. The evaluation ledger
still has one development example, zero adjudicated examples, and zero holdout
examples, so its maturity remains `insufficient-sample`.

## Current engineering checkpoint

The deployed application uses a current-stack provider-neutral evidence
projection rather than the incompatible historical Effect 3 code. Brain pages,
Slack, selected Shared Drive roots, and HubSpot inventories publish immutable
revisions into one bounded lexical retrieval path. Ask, CLI, API, and HTTP MCP
use the same exact source/revision identities; source reopening verifies the
stored content hash; connection revocation fails closed; and only a completed
full traversal infers removals. Failed and capacity-exceeded traversals preserve
the previously current corpus.

Slack and the page lifecycle now have real Apero activation receipts. Drive
OAuth, selected Drive source IDs, provider edit/removal receipts, question
evaluation, and teammate dogfood remain the human/live gates. The repository
persists approved provider scopes and reconciles them hourly; webhooks and
provider change cursors remain later latency improvements.

On 2026-08-29 the live Apero workspace's `template.brain.contextV4` rollout was
activated at 100 percent. A credential-bound `brain.ask` request for `mixed`
mode then returned ContextPack schema `4` with effective mode `mixed` and no
fallback reason. No reviewed Apero claims exist yet, so this proves the active
contract and shared Page/Slack evidence path, not reviewed-company-truth
quality.

## Authority

The product goal remains the one accepted before the canonical UI migration:
Maestro Brain is Apero's shared context plane between systems of record and
terminal-first agent runtimes. Source applications remain authoritative, the
Brain owns cited context, and Codex/Claude/Cowork own task-specific tool calls.

The detailed documents are intentionally not copied back into the current tree.
Their authoritative historical versions remain available at `d97664a4`:

- [architecture](https://github.com/modernagencysales/maestro-brain/blob/d97664a4/docs/product/apero-company-brain-architecture.md)
- [product and technical specification](https://github.com/modernagencysales/maestro-brain/blob/d97664a4/docs/product/apero-company-brain-spec.md)
- [data-first implementation plan](https://github.com/modernagencysales/maestro-brain/blob/d97664a4/docs/product/apero-company-brain-implementation-plan.md)
- [Nango Slack operations](https://github.com/modernagencysales/maestro-brain/blob/d97664a4/docs/product/apero-company-brain-nango-slack.md)

They can also be inspected locally with `git show d97664a4:docs/product/<file>`.
Later migrations replaced substantial parts of their backend model, so
historical statements marked complete are not evidence of current behavior.

Status meanings:

- **Proven:** current code plus focused automated or live protocol evidence.
- **Partial:** a usable slice exists, but the stated requirement is not closed.
- **Missing:** no current end-to-end data flow satisfies the requirement.
- **Human-only:** engineering is sufficient for the gate; an Apero owner must
  provide an account, source selection, OAuth approval, data, or acceptance.

## Completion Matrix

| Requirement                                                                                | Current evidence                                                                                                                                                                                                                | Status         | Next gate                                                                                                                                                     |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One Apero company context plane, separate from systems of record and agent execution       | Workspace-scoped Pages and provider revisions plus a four-provider Page/Slack/Drive/HubSpot contract through canonical `brain.ask`; live Apero currently proves only Page plus Slack                                            | **Partial**    | Activate one real document source and, only if selected, one structured source in the same cited Ask path without transferring workflow ownership to Brain.   |
| Shared agency workspace with separate client boundaries                                    | Live `apero` workspace; Tim owner plus an accepted test viewer; independent credential read; app-native invitation acceptance; controlled agency/client isolation; workspace-scoped page/Ask queries                            | **Proven**     | Invite the named real pilot cohort and record one human agency/client switching receipt.                                                                      |
| Terminal-first Codex, Claude Code, and Cowork onboarding                                   | Public CLI `0.1.9`; live linked `apero` key; clean-install boundary and linked green `doctor`; exact key-free runtime descriptors; verified child-process key injection; `docs/team-onboarding.md`; real Codex Ask receipt      | **Proven**     | Each real pilot links, launches Codex/Claude with `maestro-brain run`, and records one Ask receipt. Cowork import may remain manual.                          |
| One HTTP MCP context surface for every runtime                                             | Live `/mcp` has 15 tools with canonical V4 Ask, evidence/pages, knowledge review, and evaluation reads; the competing legacy V3 MCP Ask tool is absent                                                                          | **Partial**    | Log Claude in and compare exact ContextPack V4 identities from Claude/Cowork.                                                                                 |
| Ask Apero returns grounded, scoped evidence and abstains when evidence is absent           | Live cited Ask receipt over bounded provider-neutral token postings, ContextPack V4 provider/revision/hash/range citations, exact source reopening, conflicts/omissions, and explicit no-evidence abstention                    | **Partial**    | Freeze and run the real E0 question set, measure misses, and add semantic candidates only if lexical recall is insufficient.                                  |
| Human-maintained company context can enter and change safely                               | Web editor, immutable revisions, optimistic concurrency, backend-unique slugs/import identities, provenance-fenced recursive Markdown upsert, and a live CLI `0.1.2` repeat-import receipt                                      | **Partial**    | Pilot users import approved context; local file deletion intentionally does not archive a Brain page.                                                         |
| Slack is a current Apero source through Nango                                              | Live Apero receipt: 99 active/current sources after a fresh complete reconciliation, scheduled sync enabled, successful cited V4 Ask, exact immutable reopening, and exact CLI/Codex pack/citation parity                       | **Partial**    | Record real edit/removal/reconciliation timing and verify the same identity from Claude/Cowork after human login.                                             |
| Slack connection is activated in Apero                                                     | Live Nango-backed Slack scope and completed sync are present in the `apero` workspace                                                                                                                                           | **Proven**     | Keep the pilot to the approved channel scope and record the channel owner without storing secrets in Git.                                                     |
| Shared Drive/Google Docs is the first high-signal document source                          | Nango OAuth, persisted Shared Drive/root scope, recursive pagination, Google Doc/text export, immutable revisions, hourly reconciliation, citations, and explicit metadata-only/oversized skip counts                           | **Partial**    | Activate a real selected root and record edit/move/unshare/delete receipts; add change cursors only if hourly freshness is insufficient.                      |
| A structured CRM source provides account, opportunity, owner, stage, and economics context | HubSpot Nango OAuth, persisted portal scope, hourly reconciliation, and bounded company/contact/deal Markdown projections using a fixed property allowlist                                                                      | **Partial**    | Confirm HubSpot is Apero's CRM; then add property selection and owner resolution only if the approved pilot questions require CRM.                            |
| Selected Monday boards provide delivery status                                             | No current Monday adapter or ingestion path                                                                                                                                                                                     | **Missing**    | After the document and CRM gates, implement selected-board incremental reads, typed status/update projections, reconciliation, and citations.                 |
| DocuSign contributes agreement state and approved signed evidence                          | No current DocuSign adapter or ingestion path                                                                                                                                                                                   | **Missing**    | Define retention/source policy, then ingest envelope metadata first and signed documents only when explicitly approved.                                       |
| Gmail contributes only deliberately scoped communications                                  | No current Gmail adapter or ingestion path                                                                                                                                                                                      | **Missing**    | Keep post-pilot; Apero selects labels/mailboxes or forwarding addresses before engineering a bounded connector.                                               |
| Notion is available if material company authority remains there                            | No current Notion adapter or ingestion path                                                                                                                                                                                     | **Missing**    | Inventory whether Notion contains pilot-critical authority; omit it unless the evaluation set proves it is needed.                                            |
| Source changes, removals, and access loss propagate inside a declared freshness window     | Immutable revisions, successful-close removal inference, failed-run preservation, persisted approved scopes, hourly reconciliation, connection fail-closed reads, and health with source/observed/indexed/reconciled timestamps | **Partial**    | Measure real provider-to-index lag against Apero's freshness targets and add provider cursors only where hourly reconciliation misses them.                   |
| Retrieval scales beyond a small curated page set                                           | Bounded passage-local token postings rank co-located terms, retain exact source/revision/range reopening, lazily upgrade legacy projections, and fail explicit capacities                                                       | **Partial**    | Add authority ranking and evaluation-driven semantic candidates only when the real question set demonstrates the need.                                        |
| Provider tool calling stays with agents rather than a universal Brain credential           | Brain MCP is a context/page surface; the web assistant has no provider tools and reports zero tool calls                                                                                                                        | **Proven**     | Add role-specific provider tools to agent runtimes separately. Any provider write returns through a narrow audited capability and subsequent source readback. |
| Canonical `maestro-template-saas-ui` screens remain the frontend authority                 | Pinned Starter/Pro receipts, whole-screen Inbox/Search/Contacts/Connections adoption, empty deviation ledger, and `check:saas-ui-foundation`                                                                                    | **Proven**     | Retain the current adapter seams and run connected desktop/mobile acceptance after each provider UI change.                                                   |
| The replacement is at least as useful as the Claude “Ask Apero Advisors” project           | No current inventory of the Claude Project, approved real question set, scored baseline, or Apero dogfood receipt is present                                                                                                    | **Human-only** | Inventory the project and 10–20 recurring questions, designate evidence and owners, run two-user dogfood, then expand to five only after thresholds pass.     |

## Engineering Work

Engineering owns these gates and must not mark them complete based on a card,
schema, fixture, or successful OAuth alone:

1. Record real Slack allowlist, create/edit/removal, hourly reconciliation, and
   visible-health acceptance against the approved workspace.
2. Record one complete Shared Drive vertical before adding connector breadth.
3. Activate the selected CRM as a read-only structured projection only when the
   migration inventory or E0/E1 gaps justify it.
4. Score the real E0/E1 question set against bounded passage retrieval and exact
   citation reopening; add authority/semantic ranking only for measured misses.
5. Add connector health and freshness evidence that distinguishes provider time,
   observation time, and index time.
6. Preserve one context contract across web, CLI, API, MCP, Codex, Claude Code,
   and Cowork while keeping task tools in those agent runtimes.

Monday, DocuSign, Gmail, Notion, semantic retrieval, and provider writes follow
only after the first document and structured-source slices pass real-data
create/update/removal/reconciliation acceptance.

## Apero-Owned Inputs

These are not engineering defects and cannot be filled with fixtures:

1. Name the company-context owner and connector/access owner.
2. Inventory the current Claude Project, its files/instructions, and the
   recurring questions or workflows users would otherwise return to Claude for.
3. Select one to two initial dogfood users and the eventual five-person cohort.
4. Approve the initial agency pages and their authoritative source/owner.
5. Configure Nango, authorize Slack, and choose the allowed channel cohort.
6. Select the first Shared Drive folders and confirm they are suitable for the
   whole trusted pilot cohort.
7. Select the authoritative CRM and the minimum fields needed for E2, or record
   that CRM is not required for the pilot.
8. Set source freshness targets and acceptance thresholds, then judge answers
   against authoritative evidence rather than Claude output alone.

## Honest Release Gate

The read pilot is complete only when a real provider create, edit, removal, and
reconciliation produce the expected active evidence; the same question in two
terminal runtimes returns the same source revisions; every displayed citation
reopens; stale or missing evidence causes a visible abstention; and the selected
dogfood users prefer the new workflow often enough to stop relying on the Claude
Project. A merged connector or green fixture suite is necessary evidence, not
that outcome.
