# Workspace Readiness Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep Agency Brain visible during workspace-query hydration, allow an
empty authorized list to provision, and surface genuine query failures.

**Architecture:** Classify the generated workspace-list snapshot before creating
the workspace controller. Pending snapshots render an accessible route state;
settled snapshots enter the existing controller, where `ready` and `empty` are
data and failure variants preserve their real diagnostic.

**Tech Stack:** React 19, TanStack React Start, Confect React query state,
Vitest, Playwright.

## Global Constraints

- Do not change WorkOS membership, Convex authorization, or provisioning
  authority.
- Do not add timers or retry loops.
- Preserve fake/local workspace behavior.
- Use TDD and run the hosted disposable-user acceptance before release.

## Delivery Batches

- **Batch 1 — workspace readiness recovery**
  - Tasks: 1-2
  - Branch: `fix/workspace-readiness-white-screen`
  - Base and PR target: `origin/main` at
    `eb532160b7afd8b0ba356046a98ae17698ca7963`
  - Focused checks: web provider/setup tests and web typecheck
  - Whole-batch review: inspect `git diff origin/main...HEAD` for state-model
    scope and auth-boundary preservation
  - Required verification: `maestro-remote-test -- pnpm verify`

---

### Task 1: Correct workspace query-state semantics

**Files:**

- Modify: `apps/web/src/providers/workspace-operations.ts`
- Modify: `apps/web/src/providers/workspace-operations.test.ts`
- Modify: `apps/web/src/features/setup/agency-setup-failure.tsx`
- Modify: `apps/web/src/features/setup/agency-setup-failure.test.tsx`
- Modify: `apps/web/src/routes/__root.tsx`

**Interfaces:**

- Consumes: `TemplateDataState<WorkspaceList, WorkspaceError>`
- Produces: `isWorkspaceListPending(result): boolean` and
  `AgencyWorkspaceLoading`

- [ ] **Step 1: Write failing adapter tests**

Add tests that require `{ status: "empty", data: [] }` to resolve to `[]`,
pending states to be classified as pending, and a transport failure to reject
with its actual message.

- [ ] **Step 2: Run the adapter test and verify RED**

Run:
`host-test-slot --class focused pnpm --dir apps/web test -- src/providers/workspace-operations.test.ts`

Expected: the empty-list test receives `Authorized workspace list is not ready.`
and the pending helper is missing.

- [ ] **Step 3: Implement settled-state mapping**

Implement:

```ts
export const isWorkspaceListPending = (
  result: LiveWorkspaceRefs["listResult"],
) => result.status === "loading" || result.status === "skipped";
```

Map `ready` and `empty` through one summary mapper. Throw the typed/provider
message for failure states. Keep pending states unreachable from controller
initialization and fail closed if called directly.

- [ ] **Step 4: Add and test the loading route state**

Add `AgencyWorkspaceLoading` beside the existing agency setup route states,
using the existing `template-route-state` classes, `aria-busy="true"`, and
`role="status"`. In `WorkspaceRuntimeBoundary`, render it inside `RootDocument`
whenever live/test mode has a pending list result.

- [ ] **Step 5: Run focused tests and typecheck**

Run:

```sh
host-test-slot --class focused pnpm --dir apps/web test -- src/providers/workspace-operations.test.ts src/features/setup/agency-setup-failure.test.tsx src/providers/workspace.test.tsx
host-test-slot --class focused pnpm --dir apps/web typecheck
```

Expected: all commands exit 0.

- [ ] **Step 6: Commit**

```sh
git add apps/web/src/providers/workspace-operations.ts apps/web/src/providers/workspace-operations.test.ts apps/web/src/features/setup/agency-setup-failure.tsx apps/web/src/features/setup/agency-setup-failure.test.tsx apps/web/src/routes/__root.tsx
git commit -m "fix: preserve workspace query readiness"
```

### Task 2: Prove hosted onboarding does not collapse

**Files:**

- Modify: `tests/e2e/hosted-agency-signup.spec.ts`

**Interfaces:**

- Consumes: deployed Agency Brain sign-in and workspace onboarding flow
- Produces: hosted evidence that no readiness error, route error, page error, or
  blank body occurs before and after reload

- [ ] **Step 1: Extend hosted acceptance assertions**

Record browser `pageerror` events before navigation. After reaching `/brain` and
again after reload, assert the body is visible/non-empty, the exact
`Authorized workspace list is not ready.` message is absent, and no page error
was recorded.

- [ ] **Step 2: Run the hosted test against the current deployment**

Run the staging WorkOS acceptance command. Expected before deployment: existing
happy-path remains green; the new unit tests from Task 1 are the regression
proof for deterministic pending/empty states.

- [ ] **Step 3: Commit**

```sh
git add tests/e2e/hosted-agency-signup.spec.ts
git commit -m "test: reject blank workspace onboarding"
```

- [ ] **Step 4: Verify and release**

Run the exact committed head through `maestro-remote-test -- pnpm verify`, open
the PR, wait for exact-head `ci/woodpecker/pr/verify`, merge, deploy the merged
SHA to staging, and rerun hosted acceptance plus disposable WorkOS artifact
cleanup.
