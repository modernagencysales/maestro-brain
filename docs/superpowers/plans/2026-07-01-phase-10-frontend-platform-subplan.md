# Phase 10 Frontend Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add frontend platform primitives: i18n, localized emails, legal pages,
notification center, command palette, PWA, and onboarding.

**Architecture:** Keep TanStack Start and Notion Kit as the opinionated frontend
core. Platform primitives live in `packages/ui` and
`apps/web/src/features/platform`; provider-backed messaging stays in
`packages/notifications`.

**Tech Stack:** TanStack Start, React, Notion Kit, WorkOS/AuthKit, MailerSend
seam, Vite PWA manifest.

---

## Scope

Reusable frontend shell features common to B2B AI apps.

## Files

- Create: `packages/ui/src/platform/command-palette.tsx`
- Create: `packages/ui/src/platform/notification-center.tsx`
- Create: `packages/ui/src/platform/onboarding.tsx`
- Create: `packages/ui/src/platform/platform.test.tsx`
- Create: `apps/web/src/routes/_workspace.legal.tsx`
- Create: `apps/web/src/routes/_workspace.onboarding.tsx`
- Create: `apps/web/public/manifest.webmanifest`
- Modify: `apps/web/src/navigation/workspace.ts`
- Modify: `packages/notifications/src/index.ts`
- Modify: `docs/template/frontend-architecture.md`

## Tests

- `pnpm --dir packages/ui test platform.test.tsx`
- `pnpm --dir apps/web test`
- `pnpm --dir apps/web typecheck`
- `pnpm check:route-tree`

## Acceptance Criteria

- Command palette exposes route/action commands without importing backend SDKs.
- Notification center renders fake/test/live delivery states.
- Onboarding works in fake mode and names missing live provider setup.
- Legal routes exist and are clearly template placeholders to be replaced per
  client.
- PWA manifest exists without claiming offline support beyond implemented
  assets.

## Migration And Provisioning Impact

No DB changes. Optional MailerSend live emails reuse existing notification seam.

## Maturity Level

Advances L3 reusable frontend platform.

### Task 1: UI Platform Components

- [x] Write `platform.test.tsx` for command search, empty notification center,
      notification list, onboarding checklist, and localized label rendering.
- [x] Implement UI platform components using Notion Kit primitives.
- [x] Export from `packages/ui/src/index.tsx`.
- [x] Run focused UI tests.

### Task 2: Web Routes And Navigation

- [x] Add legal and onboarding routes.
- [x] Update workspace navigation.
- [x] Add manifest file.
- [x] Run `pnpm --dir apps/web test`, `pnpm --dir apps/web typecheck`, and
      `pnpm check:route-tree`.

### Task 3: Docs

- [x] Update frontend architecture docs with platform primitives and limits.
- [x] Run `pnpm check:format`.
- [x] Commit:

```bash
git add packages/ui apps/web docs/template/frontend-architecture.md
git commit -m "feat: add frontend platform primitives"
```
