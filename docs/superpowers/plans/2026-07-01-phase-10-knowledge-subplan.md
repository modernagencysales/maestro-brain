# Phase 10 Knowledge Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add concepts, claims, citations, evidence views, context pack builder,
markdown codecs, and OKF export primitives.

**Architecture:** Preserve the source-backed Brain default. Concepts and claims
are structured overlays on markdown, links, and notes; RAG remains optional and
does not become the truth model.

**Tech Stack:** TypeScript, Confect, Effect Schema, Convex, markdown codecs.

---

## Scope

Represent reusable knowledge units for B2B AI/GTM apps: concepts, claims,
citations, evidence bundles, context packs, markdown import/export, and Open
Knowledge Format export.

## Files

- Create: `packages/template-core/src/knowledge.ts`
- Create: `packages/template-core/src/knowledge.test.ts`
- Create: `packages/convex/confect/ops/knowledge.spec.ts`
- Create: `packages/convex/confect/ops/knowledge.impl.ts`
- Create: `packages/convex/confect/tables/concepts.ts`
- Create: `packages/convex/confect/tables/claims.ts`
- Create: `packages/convex/confect/tables/citations.ts`
- Create: `packages/convex/confect/tables/contextPacks.ts`
- Create: `docs/template/knowledge-model.md`
- Modify: `docs/template/data-lifecycle.md`

## Tests

- `pnpm --dir packages/template-core test knowledge.test.ts`
- `pnpm --dir packages/convex test knowledge`
- `pnpm check:schema-migration-notes`

## Acceptance Criteria

- Claims require at least one citation or an explicit `unsupported-draft`
  status.
- Context packs include source IDs, citation IDs, freshness, and trust receipt
  link.
- Markdown codec round-trips headings, links, citations, and frontmatter.
- OKF export contains concepts, claims, citations, and source metadata.

## Migration And Provisioning Impact

Add four workspace-owned tables. No provider secrets. Optional future search/RAG
providers remain outside this plan.

## Maturity Level

Advances L3 Brain foundation and L4 client specialization.

### Task 1: Knowledge Domain

- [x] Write `knowledge.test.ts` covering `createClaim`, `attachCitation`,
      `buildContextPack`, `encodeKnowledgeMarkdown`, `decodeKnowledgeMarkdown`,
      and `exportOkf`.
- [x] Run
      `host-test-slot --class focused pnpm --dir packages/template-core test knowledge.test.ts`;
      expected missing module failure.
- [x] Implement `knowledge.ts` with typed constructors and deterministic
      markdown codec.
- [x] Export from `packages/template-core/src/index.ts`.
- [x] Run the focused template-core test.

### Task 2: Confect Knowledge Group

- [x] Add Effect-schema table files for concepts, claims, citations, and context
      packs.
- [x] Create `knowledge.spec.ts` with mutations `upsertConcept`, `upsertClaim`,
      `attachCitation`, `buildContextPack`, and query `getContextPack`.
- [x] Write `packages/convex/test/knowledge.test.ts` covering typed errors
      `CitationRequired`, `WorkspaceNotFound`, and `ValidationFailed`.
- [x] Implement deterministic fake/local `knowledge.impl.ts`.
- [x] Run
      `host-test-slot --class focused pnpm --dir packages/convex test knowledge.test.ts`.

### Task 3: Docs

- [x] Create `docs/template/knowledge-model.md` explaining source-backed Brain,
      no-default-RAG posture, citations, context packs, and OKF export.
- [x] Update `data-lifecycle.md` for new resources.
- [x] Run `pnpm check:schema-migration-notes` and `pnpm check:format`.
- [x] Commit:

```bash
git add packages/template-core packages/convex docs/template
git commit -m "feat: add source-backed knowledge primitives"
```
