# Phase 10 Co-Editing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable document, version, annotation, and agent co-edit
primitives for client AI brain apps.

**Architecture:** Keep rich editing optional. Durable
document/version/annotation contracts live in `packages/convex/confect/ops` and
pure adapters live in `packages/template-core`; BlockNote/ProseMirror UI is
isolated in `packages/ui` so client forks can omit it.

**Tech Stack:** Confect, Effect Schema, Convex, TanStack Start, Notion Kit,
optional BlockNote/ProseMirror.

---

## Scope

Implement generic co-editing contracts for documents, versions, annotations,
suggestions, and agent edit proposals. Do not make BlockNote or ProseMirror
required for every client fork.

## Files

- Create: `packages/template-core/src/coediting.ts`
- Create: `packages/template-core/src/coediting.test.ts`
- Create: `packages/convex/confect/ops/coediting.spec.ts`
- Create: `packages/convex/confect/ops/coediting.impl.ts`
- Create: `packages/convex/confect/tables/documents.ts`
- Create: `packages/convex/confect/tables/documentVersions.ts`
- Create: `packages/convex/confect/tables/documentAnnotations.ts`
- Create: `packages/ui/src/coediting/coediting-shell.tsx`
- Create: `packages/ui/src/coediting/coediting-shell.test.tsx`
- Modify: `docs/template/data-lifecycle.md`
- Modify: `docs/template/repo-map.md`

## Tests

- `pnpm --dir packages/template-core test coediting.test.ts`
- `pnpm --dir packages/convex test coediting`
- `pnpm --dir packages/ui test coediting-shell.test.tsx`
- `pnpm check:schema-migration-notes`

## Acceptance Criteria

- Documents have workspace ownership, markdown body, source metadata, and stable
  IDs.
- Versions are append-only and reference prior version IDs.
- Annotations target document ranges and support human or agent authors.
- Agent suggestions are typed proposals, not direct arbitrary code execution.
- UI renders a Notion-like document page with optional annotation rail.

## Migration And Provisioning Impact

Add three Convex tables. Update data lifecycle export/delete posture for
document resources. No provider secrets required.

## Maturity Level

Advances L3 reusable product primitives.

### Task 1: Core Co-Editing Domain

- [x] Create `packages/template-core/src/coediting.test.ts` with tests for
      `createDocumentVersion`, `createAnnotation`, and `createAgentSuggestion`.
- [x] Run
      `host-test-slot --class focused pnpm --dir packages/template-core test coediting.test.ts`;
      expected failure: missing module.
- [x] Create `packages/template-core/src/coediting.ts` exporting typed
      constructors and validation errors.
- [x] Export the module from `packages/template-core/src/index.ts`.
- [x] Run
      `host-test-slot --class focused pnpm --dir packages/template-core test coediting.test.ts`;
      expected pass.

### Task 2: Confect Contracts And Tables

- [x] Create Effect-schema table files for `documents`, `documentVersions`, and
      `documentAnnotations`.
- [x] Create `coediting.spec.ts` with `listDocuments`, `createDocument`,
      `appendVersion`, and `createAnnotation` functions.
- [x] Create failing tests under `packages/convex/test/coediting.test.ts`
      proving args, returns, typed errors, and workspace ownership.
- [x] Implement `coediting.impl.ts` using fake/local deterministic storage
      behavior until live DB wiring is promoted.
- [x] Run
      `host-test-slot --class focused pnpm --dir packages/convex test coediting.test.ts`.

### Task 3: UI Shell

- [x] Create `packages/ui/src/coediting/coediting-shell.test.tsx` covering
      loading, empty, document, annotation rail, and suggestion states.
- [x] Create `packages/ui/src/coediting/coediting-shell.tsx` using Notion Kit
      page primitives and optional editor slot.
- [x] Export from `packages/ui/src/index.tsx`.
- [x] Run
      `host-test-slot --class focused pnpm --dir packages/ui test coediting-shell.test.tsx`.

### Task 4: Docs And Gates

- [x] Update `docs/template/data-lifecycle.md` with owner module, export
      posture, delete posture, and retention rule for the new tables.
- [x] Update `docs/template/repo-map.md` with co-editing primitives.
- [x] Run `pnpm check:schema-migration-notes` and `pnpm check:format`.
- [x] Commit:

```bash
git add packages/template-core packages/convex packages/ui docs/template
git commit -m "feat: add co-editing primitive plan implementation"
```
