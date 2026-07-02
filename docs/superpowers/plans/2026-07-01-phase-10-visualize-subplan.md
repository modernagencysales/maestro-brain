# Phase 10 Visualize Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add reusable visual surfaces: data grid, Kanban, calendar, funnel,
metric tiles, health board, lineage panel, and diff view.

**Architecture:** UI primitives live in `packages/ui` and consume plain view
models. Feature adapters convert Confect/workflow data to view models; UI
components do not import Convex, Confect, provider SDKs, or routes.

**Tech Stack:** React, Notion Kit, TanStack Start, Vitest, Testing Library.

---

## Scope

Build generic view components useful for B2B AI/GTM apps without adding business
logic.

## Files

- Create: `packages/ui/src/visualize/data-grid.tsx`
- Create: `packages/ui/src/visualize/kanban-board.tsx`
- Create: `packages/ui/src/visualize/calendar-board.tsx`
- Create: `packages/ui/src/visualize/funnel-view.tsx`
- Create: `packages/ui/src/visualize/metric-tiles.tsx`
- Create: `packages/ui/src/visualize/health-board.tsx`
- Create: `packages/ui/src/visualize/lineage-panel.tsx`
- Create: `packages/ui/src/visualize/diff-view.tsx`
- Create: `packages/ui/src/visualize/visualize.test.tsx`
- Modify: `packages/ui/src/index.tsx`
- Modify: `docs/template/frontend-architecture.md`

## Tests

- `pnpm --dir packages/ui test visualize.test.tsx`
- `pnpm --dir packages/ui typecheck`
- `pnpm check:route-tree`

## Acceptance Criteria

- Each component renders loading, empty, ready, and error states from view
  models.
- Components use Notion Kit styling and do not create a second design system.
- No component imports Convex, Confect, route modules, or provider SDKs.
- Text fits at mobile and desktop widths.

## Migration And Provisioning Impact

No DB or provider changes.

## Maturity Level

Advances L3 reusable frontend platform.

### Task 1: Shared View Model Types

- [x] Write `visualize.test.tsx` with one smoke test per visual component and
      import-boundary assertions.
- [x] Run
      `host-test-slot --class focused pnpm --dir packages/ui test visualize.test.tsx`;
      expected missing exports.
- [x] Create component files with typed props and Notion-style layouts.
- [x] Export from `packages/ui/src/index.tsx`.
- [x] Rerun UI tests.

### Task 2: Architecture Docs And Gates

- [x] Update `docs/template/frontend-architecture.md` with visualization
      primitives and import boundaries.
- [x] Run `pnpm --dir packages/ui typecheck`, `pnpm check:route-tree`, and
      `pnpm check:format`.
- [x] Commit:

```bash
git add packages/ui docs/template/frontend-architecture.md
git commit -m "feat: add reusable visualization primitives"
```
