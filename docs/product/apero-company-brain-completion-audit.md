# Apero Company Brain Completion Audit

**Status:** current-state audit; not a completion claim

**Audited base:** `a14a5f5b`; updated on `feat/complete-company-brain-plan`

**Date:** 2026-08-26

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
OAuth, selected source IDs, scheduled frequency, real create/edit/removal
receipts, question evaluation, and teammate dogfood remain the human/live gates.

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

| Requirement                                                                                | Current evidence                                                                                                                                                                                             | Status         | Next gate                                                                                                                                                         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| One Apero company context plane, separate from systems of record and agent execution       | Workspace-scoped `brainPages`, revisions, headless operations, and the boundary retained in the historical architecture                                                                                      | **Partial**    | Prove at least one document system and one structured system publish into the same cited Ask path without transferring workflow ownership to Brain.               |
| Shared agency workspace with separate client boundaries                                    | Workspace membership/invitation contracts, agency/client switching acceptance, and workspace-scoped page/Ask queries                                                                                         | **Proven**     | Human pilot owner creates the real Apero workspace, invites the cohort, and verifies one agency/client isolation scenario.                                        |
| Terminal-first Codex, Claude Code, and Cowork onboarding                                   | Public Brain CLI release; browser-linked setup; `.codex/config.toml`, `.mcp.json`, Cowork descriptor, and Ask Apero skill generation; `docs/team-onboarding.md`                                              | **Proven**     | Each pilot user installs, links, restarts their runtime, and records `doctor` plus one Ask receipt. Cowork descriptor import remains manual when discovery fails. |
| One HTTP MCP context surface for every runtime                                             | Live `/mcp` initialize/tool discovery; Ask, page list/get/history, and page create/update tools in `httpMcpCatalog.ts`                                                                                       | **Proven**     | Run the same approved question from Codex and Claude/Cowork and compare exact source revision identities.                                                         |
| Ask Apero returns grounded, scoped evidence and abstains when evidence is absent           | Ask uses bounded provider-neutral token postings, ContextPack v3 provider/revision/hash/range citations, exact source reopening, and explicit no-evidence abstention                                         | **Partial**    | Run the real E0 question set, measure misses, and add semantic candidates only if lexical recall is insufficient.                                                 |
| Human-maintained company context can enter and change safely                               | Web editor, immutable page revisions, optimistic concurrency, CLI page create/update, and recursive Markdown import                                                                                          | **Partial**    | Add source-aware upsert/reconciliation for repeat imports; current folder import is create-oriented and is not a live folder sync.                                |
| Slack is a current Apero source through Nango                                              | Nango OAuth, full bounded channel/history/thread pagination, immutable message revisions, full-run reconciliation, failed-run preservation, and visible health are implemented                               | **Partial**    | Add scheduled or webhook acceleration, decide file coverage, and record a real-provider create/edit/delete receipt.                                               |
| Slack connection is activated in Apero                                                     | Code accepts `NANGO_SECRET_KEY` and a Nango integration ID                                                                                                                                                   | **Human-only** | Configure the production Nango integration/secrets, authorize the approved Slack workspace, select allowed channels, and run the real sync acceptance.            |
| Shared Drive/Google Docs is the first high-signal document source                          | Nango OAuth, selected Shared Drive/root-folder scope, recursive pagination, Google Doc/text export, metadata-only binary reporting, immutable revisions, reconciliation, and citations are implemented       | **Partial**    | Add scheduled sync/change cursor acceleration and record real move-out/unshare/delete receipts against the selected Apero roots.                                  |
| A structured CRM source provides account, opportunity, owner, stage, and economics context | HubSpot Nango OAuth and bounded company/contact/deal inventories publish stable typed-property evidence through the canonical projection                                                                     | **Partial**    | Confirm HubSpot is Apero's CRM, tune the approved property set, schedule sync, and record real update/removal receipts.                                           |
| Selected Monday boards provide delivery status                                             | No current Monday adapter or ingestion path                                                                                                                                                                  | **Missing**    | After the document and CRM gates, implement selected-board incremental reads, typed status/update projections, reconciliation, and citations.                     |
| DocuSign contributes agreement state and approved signed evidence                          | No current DocuSign adapter or ingestion path                                                                                                                                                                | **Missing**    | Define retention/source policy, then ingest envelope metadata first and signed documents only when explicitly approved.                                           |
| Gmail contributes only deliberately scoped communications                                  | No current Gmail adapter or ingestion path                                                                                                                                                                   | **Missing**    | Keep post-pilot; Apero selects labels/mailboxes or forwarding addresses before engineering a bounded connector.                                                   |
| Notion is available if material company authority remains there                            | No current Notion adapter or ingestion path                                                                                                                                                                  | **Missing**    | Inventory whether Notion contains pilot-critical authority; omit it unless the evaluation set proves it is needed.                                                |
| Source changes, removals, and access loss propagate inside a declared freshness window     | Immutable revisions, exclusive/stale-recovered runs, successful-close removal inference, failed-run preservation, single approved provider scope replacement, connection fail-closed reads, and health exist | **Partial**    | Add schedules/change cursors and measure real provider-to-index lag against Apero's freshness targets.                                                            |
| Retrieval scales beyond a small curated page set                                           | Bounded token postings and current-entry pointers avoid page/revision scans and return exact 640-character ranges; explicit capacities fail instead of truncating                                            | **Partial**    | Add passage chunking, authority ranking, and evaluation-driven semantic candidates only when the real question set demonstrates the need.                         |
| Provider tool calling stays with agents rather than a universal Brain credential           | Brain MCP is a context/page surface; the web assistant has no provider tools and reports zero tool calls                                                                                                     | **Proven**     | Add role-specific provider tools to agent runtimes separately. Any provider write returns through a narrow audited capability and subsequent source readback.     |
| Canonical `maestro-template-saas-ui` screens remain the frontend authority                 | Pinned Starter/Pro receipts, whole-screen Inbox/Search/Contacts/Connections adoption, empty deviation ledger, and `check:saas-ui-foundation`                                                                 | **Proven**     | Retain the current adapter seams and run connected desktop/mobile acceptance after each provider UI change.                                                       |
| The replacement is at least as useful as the Claude “Ask Apero Advisors” project           | No current inventory of the Claude Project, approved real question set, scored baseline, or Apero dogfood receipt is present                                                                                 | **Human-only** | Inventory the project and 10–20 recurring questions, designate evidence and owners, run two-user dogfood, then expand to five only after thresholds pass.         |

## Engineering Work

Engineering owns these gates and must not mark them complete based on a card,
schema, fixture, or successful OAuth alone:

1. Make Slack incremental and reconciled, including removals and visible health.
2. Deliver one complete Shared Drive vertical before adding connector breadth.
3. Deliver the selected CRM as a read-only structured projection only when the
   migration inventory or E0/E1 gaps justify it.
4. Replace small-corpus substring retrieval with bounded, source-aware passage
   retrieval and exact citation reopening.
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
