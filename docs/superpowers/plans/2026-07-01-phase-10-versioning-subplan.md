# Phase 10 Versioning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add generalized versioned entries, append-only restore, freshness
tracking, causation taxonomy, and idempotent reconcile primitives.

**Architecture:** Implement versioning as pure template-core domain logic first,
then expose Confect contracts. Keep version entries generic so documents, Brain
pages, policies, prompts, workflows, and generated artifacts can reuse them.

**Tech Stack:** TypeScript, Confect, Effect Schema, Convex.

---

## Scope

Build a reusable versioning primitive for any workspace-owned entity with stable
entity key, version key, causation, freshness, restore, and reconciliation.

## Files

- Create: `packages/template-core/src/versioning.ts`
- Create: `packages/template-core/src/versioning.test.ts`
- Create: `packages/convex/confect/ops/versioning.spec.ts`
- Create: `packages/convex/confect/ops/versioning.impl.ts`
- Create: `packages/convex/confect/tables/versionedEntries.ts`
- Create: `packages/convex/confect/tables/versionFreshness.ts`
- Modify: `docs/template/data-lifecycle.md`
- Modify: `docs/template/coding-standards.md`

## Tests

- `pnpm --dir packages/template-core test versioning.test.ts`
- `pnpm --dir packages/convex test versioning`
- `pnpm check:schema-migration-notes`

## Acceptance Criteria

- Versions are append-only and restore creates a new version.
- Causation is one of `human-edit`, `agent-edit`, `import`, `migration`,
  `reconcile`, or `restore`.
- Reconcile is idempotent by workspace, entity key, external version, and
  idempotency key.
- Freshness is stored separately from immutable entry history.

## Migration And Provisioning Impact

Add `versionedEntries` and `versionFreshness` tables. No external provider
provisioning.

## Maturity Level

Advances L3 safety and upgradeability.

### Task 1: Domain Model

- [x] Write `packages/template-core/src/versioning.test.ts` for append-only
      create, restore-as-new-version, freshness update, and idempotent
      reconcile.
- [x] Run
      `host-test-slot --class focused pnpm --dir packages/template-core test versioning.test.ts`;
      expected failure: missing module.
- [x] Implement `packages/template-core/src/versioning.ts` with discriminated
      unions for causation and functions `appendVersion`, `restoreVersion`,
      `markFreshness`, and `reconcileExternalVersion`.
- [x] Export from `packages/template-core/src/index.ts`.
- [x] Run
      `host-test-slot --class focused pnpm --dir packages/template-core test versioning.test.ts`.

### Task 2: Confect Contracts

- [x] Add Effect schema tables for `versionedEntries` and `versionFreshness`.
- [x] Create `versioning.spec.ts` with public mutations `append`, `restore`,
      `reconcile`, and query `latest`.
- [x] Write `packages/convex/test/versioning.test.ts` covering typed args,
      returns, and errors.
- [x] Implement `versioning.impl.ts` with deterministic fake/local behavior.
- [x] Run
      `host-test-slot --class focused pnpm --dir packages/convex test versioning.test.ts`.

### Task 3: Lifecycle Docs

- [x] Add owner module, export posture, delete posture, and retention rule for
      both versioning tables.
- [x] Add coding standard: never mutate historical version rows.
- [x] Run `pnpm check:schema-migration-notes` and `pnpm check:format`.
- [x] Commit:

```bash
git add packages/template-core packages/convex docs/template
git commit -m "feat: add reusable versioning primitives"
```
