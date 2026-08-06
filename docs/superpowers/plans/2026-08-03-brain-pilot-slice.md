# Brain Pilot Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development to implement this plan task-by-task.

**Goal:** Turn the existing Brain route and backend page primitives into a
usable internal pilot for reviewed source notes, editable Brain pages, and
citation-bearing search.

**Architecture:** Reuse `brain.pages` for tenant-scoped page CRUD and add one
small Brain pilot contract for note submission, review/publish, and
deterministic search. The web route owns the pilot state machine and renders
explicit loading, empty, ready, edit, success, and failure states.

**Tech Stack:** TypeScript, TanStack Router, React, Saas UI, Convex/Confect,
Effect Schema, Vitest.

## Global Constraints

- Use only the existing repository patterns; add no dependencies.
- Preserve server-derived workspace authorization and stable public keys.
- Do not edit `repos/`, generated files, or revive factory/Fabro tooling.
- Use pnpm 10.12.1 and focused tests for every task.
- Production code is written only after a failing behavior test.

### Task 1: Brain pilot contract and persistence

**Files:**

- Create or modify: `packages/convex/confect/brain/pilot.spec.ts`
- Create or modify: `packages/convex/confect/brain/pilot.impl.ts`
- Create or modify: `packages/convex/confect/tables/brainSources.ts`
- Create or modify: `packages/convex/convex/brain/pilot.ts`
- Test: colocated `pilot.spec.ts` and implementation tests following existing
  Brain conventions.

**Interfaces:**

- `submitNote({ brainKey, title, markdown })` returns a stable source key and
  `status: "pending_review"`.
- `reviewNote({ brainKey, sourceKey, decision })` accepts `"approve" | "reject"`
  and returns the source status.
- `search({ brainKey, query })` returns matching published page/source excerpts
  with stable citation keys.

- [ ] Add failing contract tests for editor authorization, pending review,
      approve/reject, tenant isolation, and deterministic search citations.
- [ ] Run the focused Brain contract tests and confirm the new behaviors fail
      for the missing contract.
- [ ] Implement the smallest Confect schemas, table, authorization checks, and
      deterministic substring search.
- [ ] Run the focused tests until green, then run formatting and diff checks.
- [ ] Commit as `feat: add reviewed brain pilot contract`.

### Task 2: Brain workspace UI

**Files:**

- Modify: `apps/web/src/routes/_workspace.brain.tsx`
- Modify or replace: `apps/web/src/features/brain/brain-surface.ts`
- Modify or replace: `apps/web/src/features/brain/brain-surface.test.ts`
- Create: `apps/web/src/features/brain/brain-workspace.tsx`
- Test: `apps/web/src/features/brain/brain-workspace.test.tsx`

**Interfaces:**

- Consume the existing `brain.pages` refs and Task 1 pilot refs.
- Render an authorized editor flow for note submission, review decision, page
  edit/save, and search result citations.

- [ ] Add failing component tests for loading, empty, ready/read, ready/edit,
      review success/failure, and search citations.
- [ ] Run the focused web tests and confirm the new states fail.
- [ ] Implement the smallest accessible Saas UI surface without changing the
      global shell.
- [ ] Run focused web tests, typecheck, lint, formatting, and route checks.
- [ ] Commit as `feat: wire brain pilot workspace`.

### Task 3: Integration and release check

**Files:**

- Modify only files required to reconcile Tasks 1-2.
- Test: affected Convex and web suites.

- [ ] Review both task diffs for tenant, authorization, generated-file, and
      scope violations.
- [ ] Reconcile any contract/ref naming or generated registration needed by the
      existing repository workflow.
- [ ] Run focused backend and web suites, then the repository's typecheck and
      lint gates.
- [ ] Commit the integration only after all fresh commands pass.

## Acceptance

An authorized editor can submit a note, see it pending review, approve it,
publish it into a Brain page, edit the page, search for a term, and receive
matching text with a stable source citation. Unauthorized access, loading,
empty, and mutation-failure states have behavior tests.
