# Maestro Brain Planning Restart Handoff

**Created:** 2026-07-14  
**Purpose:** durable handoff from `lappy` to the `headless` tmux session while
the local computer restarts.

## Active Objective

Finish and validate the exhaustive implementation plan at:

`docs/superpowers/plans/2026-07-14-maestro-brain-agency-context-os-implementation-plan.md`

The approved source specification is:

`docs/superpowers/specs/2026-07-14-maestro-brain-agency-context-os-design.md`

This is a planning/documentation task only. Do not begin product implementation.

## Current State

- The approved design is complete at 1,769 lines.
- The implementation plan is currently 2,891 lines.
- All fourteen implementation stacks and all fifty-five self-contained task
  packets are written through S13.
- Appendices A-F are written: dependency/line budgets, RBAC, tables/indexes,
  provider/env inventory, Slack scopes/events, and capability contracts.
- Appendices G-N still need to be added:
  1. complete state-machine inventory;
  2. lifecycle propagation matrix;
  3. negative/adversarial test matrix;
  4. semantic-eval thresholds and capacity fixture;
  5. migration/backfill/cutover/rollback protocol;
  6. CI/staging/pilot/launch evidence contract;
  7. requirement-to-task coverage ledger;
  8. whole-program Definition of Done.
- After those appendices, audit every task for classification, dependencies,
  exact files, pinned existing-code citations, failing test first, typed
  contracts/state, migration/rollback, focused commands, receipt, and commit/PR
  boundary.

## Non-Negotiable Decisions

- Use `maestro-template-saas-ui`, not another Maestro fork.
- Reuse exact roles `viewer | editor | admin | owner`.
- Convex Codex plugin install on all three working computers is implementation
  gate S00-T01: `codex plugin add convex@openai-curated`.
- Deterministic pipes and model cognition stay separate under ZFC.
- One agency Slack connection; multiple explicitly joined channels are
  mandatory; no auto-join or one-channel sampling.
- Nango owns OAuth/token refresh/API proxy/actions; Maestro owns signed binding,
  exact capture, per-channel cursors, routing, lifecycle, and delivery auth.
- Slack Connect is capture-only in V1. Internal Slack answers are requester-
  private; channel membership never grants full-Brain read access.
- Classify is review-first and chooses zero or exactly one Brain from a finite
  human-selected allowlist.
- External API/MCP is read-only and one-Brain-scoped.
- Analytics/connectors, file ingestion, re-import, Git sync, write MCP, weekly
  digests, and content generation are later.
- Every slice is classified as `fixture-to-real`, `pattern-instance`, or
  `template-gap`; maximum 300 changed source lines and four slices per stack.
- Keep one canonical Markdown plan. Generate temporary stack JSON immediately
  before implementation only.

## Existing Review Context

Three independent reviews were already incorporated. Their most important
corrections were: real auth/tenancy first; stable keys before public contracts;
capture-only Slack Connect; immutable content-bearing snapshots before model
classification; one committed effect over at-least-once attempts; total
ordering/fencing for edits and stale jobs; lifecycle propagation across raw and
derived copies; server-derived tenant authorization; signed/replay-safe webhook
binding; current-role reauthorization before Slack/API/MCP delivery; async
workspace-scoped search projections; and stateless bearer-authenticated MCP.

Do not spawn new reviewers unless the user explicitly asks again.

## Repo Rules

- Read `/Users/headless/.codex/RTK.md`, repo `AGENTS.md`, and
  `.claude/skills/planning/SKILL.md` before editing.
- Prefix every shell command with `rtk`.
- Use `apply_patch` for edits.
- Preserve unrelated work and generated files.
- Do not hand-edit Confect/Convex generated files.
- Do not claim a gate passed without exact output.

## Required Final Validation

Run from the repo root:

```bash
rtk pnpm exec prettier --write docs/superpowers/plans/2026-07-14-maestro-brain-agency-context-os-implementation-plan.md docs/superpowers/specs/2026-07-14-maestro-brain-agency-context-os-design.md docs/superpowers/receipts/maestro-brain/restart-handoff.md
rtk pnpm exec prettier --check docs/superpowers/plans/2026-07-14-maestro-brain-agency-context-os-implementation-plan.md docs/superpowers/specs/2026-07-14-maestro-brain-agency-context-os-design.md docs/superpowers/receipts/maestro-brain/restart-handoff.md
rtk pnpm check:docs-freshness
rtk git diff --check
rtk just verify-full
rtk git status --short
```

Commit only the three documentation files above unless the user explicitly
changes scope. Push the active branch so the local machine can resume from it
after restart.
