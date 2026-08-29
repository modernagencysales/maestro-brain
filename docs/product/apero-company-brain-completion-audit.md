# Apero Company Brain Completion Audit

**Status:** current-state audit; not a completion claim

**Audited base:** `25bea20a`; live activation evidence is recorded in
`docs/product/apero-company-brain-live-activation.md`

**Date:** 2026-08-26

## 2026-08-29 local readiness update

The core V4 engineering pass is locally implemented, but the V1 definition of
done remains open. Three independent cold reviews agreed that the repository
must not be called pilot-complete without real Slack/Drive evidence, a frozen
evaluation set, cross-runtime live identity checks, and the elapsed Apero
replacement pilot.

Since the prior checkpoint, the local product path gained exact immutable web
citation reopening, visible ContextPack identity/conflicts/omissions, explicit
web evaluation capture, bounded five-item review with edit/bulk reject,
reviewer-selected freshness horizons, accepted-claim copy-for-Page, terminal
candidate review and exact evidence reopening, configurable narrow Slack sync,
bounded rate-limit retry, and claim review-due propagation on source withdrawal.
Commit `25bea20a` passed the clean full local gate: 710/710 Convex tests, 9/9
required runtime acceptance scenarios, typecheck, production build, generated
files, Confect manifest, headless contract, and lint with zero errors. It is not
deployed. The live staging catalog still exposes the older nine-tool surface and
therefore rejects the new `brain.ask`/knowledge-review calls.

Read-only staging verification on 2026-08-29 also supersedes the earlier empty
Slack status: Apero has 101 active Slack sources, 101 current entries, and a
completed reconciliation. A Slack search result reopened the exact immutable
source/revision/content-hash tuple without exposing its body in this receipt.
Google Drive remains empty. These live facts advance V1A but do not prove the
required Slack edit/removal lifecycle, Drive vertical, V4 runtime parity, or
replacement pilot.

## Current engineering checkpoint

The feature branch now restores a current-stack provider-neutral evidence
projection rather than restoring the incompatible historical Effect 3 code.
Brain pages, Slack, selected Shared Drive roots, and HubSpot inventories publish
immutable revisions into one bounded lexical retrieval path. Ask, CLI, API, and
HTTP MCP use the same exact source/revision identities; source reopening
verifies the stored content hash; connection revocation fails closed; and only a
completed full traversal infers removals. Failed and capacity-exceeded
traversals preserve the previously current corpus.

This is repository-side proof, not a real Apero activation receipt. Provider
OAuth, selected source IDs, real create/edit/removal receipts, question
evaluation, and teammate dogfood remain the human/live gates. The repository
persists approved provider scopes and reconciles them hourly; webhooks and
provider change cursors remain later latency improvements.

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
| One Apero company context plane, separate from systems of record and agent execution       | Workspace-scoped `brainPages`, revisions, headless operations, and the boundary retained in the historical architecture                                                                                                         | **Partial**    | Prove at least one document system and one structured system publish into the same cited Ask path without transferring workflow ownership to Brain.           |
| Shared agency workspace with separate client boundaries                                    | Live `apero` workspace; Tim owner plus an accepted test viewer; independent credential read; app-native invitation acceptance; controlled agency/client isolation; workspace-scoped page/Ask queries                            | **Proven**     | Invite the named real pilot cohort and record one human agency/client switching receipt.                                                                      |
| Terminal-first Codex, Claude Code, and Cowork onboarding                                   | Public CLI `0.1.4`; live linked `apero` key; clean-install green `doctor`; key-free runtime descriptors; verified child-process key injection; `docs/team-onboarding.md`                                                        | **Proven**     | Each real pilot links, launches Codex/Claude with `maestro-brain run`, and records one Ask receipt. Cowork import may remain manual.                          |
| One HTTP MCP context surface for every runtime                                             | Live `/mcp` initialize and legacy nine-tool discovery; authenticated page/evidence CRUD; exact source reopening; CLI-generated Codex, Claude, and Cowork descriptors                                                            | **Partial**    | Deploy `25bea20a`, confirm `brain.ask` plus knowledge tools, then run one approved question from Codex and Claude/Cowork and compare exact V4 identities.     |
| Ask Apero returns grounded, scoped evidence and abstains when evidence is absent           | Ask uses bounded provider-neutral token postings, ContextPack v3 provider/revision/hash/range citations, exact source reopening, and explicit no-evidence abstention                                                            | **Partial**    | Run the real E0 question set, measure misses, and add semantic candidates only if lexical recall is insufficient.                                             |
| Human-maintained company context can enter and change safely                               | Web editor, immutable revisions, optimistic concurrency, backend-unique slugs/import identities, provenance-fenced recursive Markdown upsert, and a live CLI `0.1.2` repeat-import receipt                                      | **Partial**    | Pilot users import approved context; local file deletion intentionally does not archive a Brain page.                                                         |
| Slack is a current Apero source through Nango                                              | Live Apero receipt: 101 active/current sources, completed reconciliation, successful lexical search, and exact immutable source/revision/hash reopening; code retains bounded traversal and fail-closed scope behavior          | **Partial**    | Record real edit/removal/reconciliation timing and verify the deployed V4 Ask path returns the same exact identity across two runtimes.                       |
| Slack connection is activated in Apero                                                     | Live Nango-backed Slack scope and completed sync are present in the `apero` workspace                                                                                                                                           | **Proven**     | Keep the pilot to the approved single channel after deploying `25bea20a`; record the channel owner without storing secrets in Git.                            |
| Shared Drive/Google Docs is the first high-signal document source                          | Nango OAuth, persisted Shared Drive/root scope, recursive pagination, Google Doc/text export, metadata-only binary reporting, immutable revisions, hourly reconciliation, and citations                                         | **Partial**    | Record real move-out/unshare/delete receipts; add change-cursor acceleration only if hourly freshness is insufficient.                                        |
| A structured CRM source provides account, opportunity, owner, stage, and economics context | HubSpot Nango OAuth, persisted portal scope, hourly reconciliation, and bounded company/contact/deal inventories publish stable typed-property evidence                                                                         | **Partial**    | Confirm HubSpot is Apero's CRM, tune the approved property set, and record real update/removal receipts.                                                      |
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
