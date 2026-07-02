# Phase 10 Transform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add transformation definitions, traced transformation blocks, drift
alerts, and Trust Receipt projection.

**Architecture:** Transformations are typed plans that consume source-backed
context and produce auditable outputs. They record inputs, policy snapshots,
model receipts, and evidence hashes so every generated output can project to a
Trust Receipt.

**Tech Stack:** TypeScript, Confect, Effect Schema, Convex, notifications alert
seam.

---

## Scope

Generic transformation primitives for client-specific workflows: briefs,
reports, email drafts, analysis outputs, CRM updates, and other auditable AI
transformations.

## Files

- Create: `packages/template-core/src/transforms.ts`
- Create: `packages/template-core/src/transforms.test.ts`
- Create: `packages/convex/confect/ops/transforms.spec.ts`
- Create: `packages/convex/confect/ops/transforms.impl.ts`
- Create: `packages/convex/confect/tables/transformDefinitions.ts`
- Create: `packages/convex/confect/tables/transformRuns.ts`
- Create: `packages/convex/confect/tables/transformBlocks.ts`
- Modify: `packages/notifications/src/index.ts`
- Modify: `docs/template/data-lifecycle.md`

## Tests

- `pnpm --dir packages/template-core test transforms.test.ts`
- `pnpm --dir packages/convex test transforms`
- `pnpm --dir packages/notifications test`

## Acceptance Criteria

- Transform definitions declare input schema ref, output schema ref, policy
  kind, and evidence requirements.
- Transform runs produce traced blocks with input hash, output hash, source IDs,
  policy snapshot ID, and model receipt ID.
- Drift alert emits through `createAlertService` with redacted metadata.
- Trust Receipt projection is deterministic from run evidence.

## Migration And Provisioning Impact

Add three transform tables. Reuse notifications alert seam. No new secrets.

## Maturity Level

Advances L3 workflow reliability and L4 app-specific transformation packs.

### Task 1: Transform Domain

- [x] Write `transforms.test.ts` covering definition validation, block tracing,
      drift detection, and trust receipt projection.
- [x] Run
      `host-test-slot --class focused pnpm --dir packages/template-core test transforms.test.ts`.
- [x] Implement `packages/template-core/src/transforms.ts`.
- [x] Export from `packages/template-core/src/index.ts`.
- [x] Rerun focused test.

### Task 2: Confect Transform Group

- [x] Add Effect-schema tables for definitions, runs, and blocks.
- [x] Create `transforms.spec.ts` with `registerDefinition`, `runTransform`,
      `getRun`, and `projectTrustReceipt`.
- [x] Write `packages/convex/test/transforms.test.ts`.
- [x] Implement deterministic fake/local `transforms.impl.ts`.
- [x] Run
      `host-test-slot --class focused pnpm --dir packages/convex test transforms.test.ts`.

### Task 3: Drift Alerts And Docs

- [x] Extend notifications tests with transform drift alert payload.
- [x] Use `createAlertService` from transform domain tests through dependency
      injection.
- [x] Update `data-lifecycle.md`.
- [x] Run package tests and `pnpm check:format`.
- [x] Commit:

```bash
git add packages/template-core packages/convex packages/notifications docs/template
git commit -m "feat: add traced transform primitives"
```
