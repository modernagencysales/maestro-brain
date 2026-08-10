# Self-Service Agency Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a verified zero-membership WorkOS signup create one isolated
agency and reach Agency Brain without `Route unavailable`.

**Architecture:** A small pure onboarding orchestrator owns the zero-membership
and interrupted-setup decisions. A WorkOS adapter supplies organization and
membership effects, AuthKit switches the current session, and the existing
Convex provisioner remains the only Brain tenant writer. Root runtime adds one
`setupFailure` outcome rendered before organization-dependent providers mount.

**Tech Stack:** TypeScript 5.9, React 19, TanStack Start, WorkOS/AuthKit 0.9.1,
`@workos-inc/node` 10.7.0, Convex 1.42, Vitest 3, Playwright 1.61, Cloudflare
Workers.

## Global Constraints

- Public signup never joins WRIP or another existing organization.
- Only a verified user with zero active WorkOS memberships may create an agency.
- Interrupted setup may resume only `maestro-brain-founder:{workosUserId}` for
  that same user.
- Reuse AuthKit `switchToOrganization` and existing Convex
  `ensureProvisionedFromWorkos`.
- Do not add a job queue, workflow, retry framework, or client-side auth state
  machine.
- Render setup failure before AuthKit, workspace, Convex-query, or shell
  providers mount.
- Fabro remains paused; Woodpecker is the required CI authority.
- Preserve unrelated work and never expose WorkOS credentials or response
  bodies.

## File Structure

- Create `apps/web/src/auth/agency-onboarding.ts`: pure orchestration,
  deterministic keys, and narrow dependency contract.
- Create `apps/web/src/auth/agency-onboarding.test.ts`: behavior and isolation
  tests for the orchestrator.
- Create `apps/web/src/auth/workos-agency-adapter.ts`: WorkOS Node and AuthKit
  effect adapter.
- Create `apps/web/src/auth/workos-agency-adapter.test.ts`: payload and
  conflict-recovery tests.
- Modify `apps/web/src/auth/authkit-server.ts`: represent verified WorkOS user
  fields and `setupFailure` runtime.
- Modify `apps/web/src/auth/safe-client-runtime.server.ts`: invoke onboarding
  before Convex provisioning.
- Modify `apps/web/src/auth/workos-server-adapter.ts`: expose organization
  switch and logout primitives.
- Create `apps/web/src/features/setup/agency-setup-failure.tsx`: accessible
  recovery surface.
- Create `apps/web/src/features/setup/agency-setup-failure.test.tsx`: copy,
  semantics, and controls.
- Create `apps/web/src/routes/logout.tsx`: server-side AuthKit logout.
- Modify `apps/web/src/routes/__root.tsx`: short-circuit `setupFailure` before
  live providers.
- Modify `apps/web/src/auth/authkit-routes.test.ts`: logout and recovery route
  contracts.
- Modify `apps/web/package.json` and `pnpm-lock.yaml`: direct `@workos-inc/node`
  dependency.
- Create `tests/e2e/hosted-agency-signup.spec.ts`: real zero-membership release
  acceptance and WorkOS cleanup.

## Delivery Batches

### Batch 1: Self-service agency onboarding

- Tasks: 1-4.
- Branch/head: `fix/self-service-agency-onboarding` / frozen after Task 4.
- Base: `6b8f03ffff0956b86351a7f230436c992745dfe8` (`origin/main`).
- PR target: `main`.
- Focused task checks: exact Vitest files listed by each task.
- Whole-batch review: inspect `git diff 6b8f03ff...HEAD` for tenant authority,
  secret handling, unsafe GET redirects, provider mounting, and test cleanup.
- Required verification: `rtk maestro-remote-test -- pnpm verify` on the frozen
  committed head.
- Required CI: `ci/woodpecker/pr/verify` on that exact feature SHA.
- Release proof: successful GitHub staging deployment plus hosted fresh-signup
  acceptance.

---

### Task 1: Pure agency-onboarding decision boundary

**Files:**

- Create: `apps/web/src/auth/agency-onboarding.ts`
- Create: `apps/web/src/auth/agency-onboarding.test.ts`

**Interfaces:**

- Consumes: server-derived WorkOS user and narrow async dependency functions.
- Produces:

```ts
export type AgencySetupResult =
  | {
      readonly kind: "authenticated";
      readonly organizationId: string;
      readonly accessToken: string;
    }
  | {
      readonly kind: "setupFailure";
      readonly reason:
        "identity_unverified" | "existing_membership" | "provider_failure";
    };

export type AgencyOnboardingDependencies = {
  readonly listActiveMemberships: (
    userId: string,
  ) => Promise<readonly { organizationId: string }[]>;
  readonly getOrganizationByExternalId: (
    externalId: string,
  ) => Promise<{ id: string; externalId: string } | null>;
  readonly createOrganization: (input: {
    name: string;
    externalId: string;
    idempotencyKey: string;
  }) => Promise<{ id: string; externalId: string }>;
  readonly createMembership: (input: {
    organizationId: string;
    userId: string;
  }) => Promise<void>;
  readonly switchOrganization: (
    organizationId: string,
  ) => Promise<{ organizationId?: string; accessToken?: string }>;
};

export const ensureAgencyForUser: (input: {
  readonly user: {
    id: string;
    email: string;
    emailVerified: boolean;
    name: string | null;
    firstName: string | null;
    lastName: string | null;
  };
  readonly dependencies: AgencyOnboardingDependencies;
}) => Promise<AgencySetupResult>;
```

- [ ] **Step 1: Write failing behavior tests**

Cover these exact cases with in-memory dependency functions that record calls:

```ts
it("creates and switches one agency for a verified zero-membership user", async () => {
  const result = await ensureAgencyForUser({ user, dependencies });
  expect(result).toEqual({
    kind: "authenticated",
    organizationId: "org_new",
    accessToken: "token_new",
  });
  expect(calls.createOrganization).toEqual([
    {
      name: "Tim Keen Agency",
      externalId: `maestro-brain-founder:${user.id}`,
      idempotencyKey: `maestro-brain-founder:v1:${user.id}`,
    },
  ]);
});

it("resumes only the founding user's deterministic organization", async () => {
  dependencies.getOrganizationByExternalId = async () => ({
    id: "org_owned",
    externalId: `maestro-brain-founder:${user.id}`,
  });
  dependencies.listActiveMemberships = async () => [
    { organizationId: "org_owned" },
  ];
  expect(await ensureAgencyForUser({ user, dependencies })).toMatchObject({
    kind: "authenticated",
    organizationId: "org_owned",
  });
  expect(calls.createOrganization).toEqual([]);
});

it("refuses an unrelated active membership", async () => {
  dependencies.listActiveMemberships = async () => [
    { organizationId: "org_wrip" },
  ];
  expect(await ensureAgencyForUser({ user, dependencies })).toEqual({
    kind: "setupFailure",
    reason: "existing_membership",
  });
  expect(calls.switchOrganization).toEqual([]);
});
```

Also test unverified identity, interrupted organization-before-membership
recovery, provider failure, and mismatched switch output.

- [ ] **Step 2: Run tests and verify RED**

Run:

```sh
rtk host-test-slot --class focused pnpm --dir apps/web exec vitest run src/auth/agency-onboarding.test.ts
```

Expected: FAIL because `agency-onboarding.ts` does not exist.

- [ ] **Step 3: Implement the minimal orchestrator**

Use these deterministic helpers and no framework abstraction:

```ts
export const agencyExternalId = (userId: string) =>
  `maestro-brain-founder:${userId}`;
export const agencyIdempotencyKey = (userId: string) =>
  `maestro-brain-founder:v1:${userId}`;
export const agencyName = (user: AgencyOnboardingUser) => {
  const display =
    user.name?.trim() ||
    [user.firstName, user.lastName].filter(Boolean).join(" ").trim() ||
    user.email.split("@")[0] ||
    "New";
  return `${display} Agency`;
};
```

The function must read memberships and the deterministic organization, reject
unverified users, reject unrelated memberships, create only when memberships are
empty, create a missing membership for an interrupted owned organization,
switch, verify the returned organization and token, and map provider exceptions
to `provider_failure`.

- [ ] **Step 4: Run tests and verify GREEN**

Run the Step 2 command. Expected: all tests in the file pass.

- [ ] **Step 5: Review and commit Task 1**

```sh
rtk git diff --check
rtk git add apps/web/src/auth/agency-onboarding.ts apps/web/src/auth/agency-onboarding.test.ts
rtk git commit -m "feat: define safe agency onboarding boundary"
```

Review: no dependency function receives browser-supplied authority; unrelated
memberships never switch or create.

### Task 2: WorkOS adapter and server runtime integration

**Files:**

- Create: `apps/web/src/auth/workos-agency-adapter.ts`
- Create: `apps/web/src/auth/workos-agency-adapter.test.ts`
- Modify: `apps/web/src/auth/authkit-server.ts`
- Modify: `apps/web/src/auth/authkit-server.test.ts`
- Modify: `apps/web/src/auth/safe-client-runtime.server.ts`
- Modify: `apps/web/src/auth/workos-server-adapter.ts`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`

**Interfaces:**

- Consumes: `ensureAgencyForUser`, `WorkOS`, AuthKit `switchToOrganization`,
  current server env, and existing Convex provisioning action.
- Produces: `loadSafeClientRuntimeOnServer()` returning `authenticated`,
  `signedOut`, or `setupFailure` without throwing for organization-less
  sessions.

- [ ] **Step 1: Add direct dependency**

Run:

```sh
rtk pnpm --dir apps/web add @workos-inc/node@10.7.0
```

Expected: `apps/web/package.json` and `pnpm-lock.yaml` name version `10.7.0`; no
other dependency upgrades.

- [ ] **Step 2: Write failing adapter and runtime tests**

Tests must assert:

```ts
expect(client.organizations.createOrganization).toHaveBeenCalledWith(
  { name: "Tim Keen Agency", externalId },
  { idempotencyKey },
);
expect(client.userManagement.listOrganizationMemberships).toHaveBeenCalledWith({
  userId,
  statuses: ["active"],
  limit: 100,
});
expect(switchToOrganization).toHaveBeenCalledWith({
  data: { organizationId: "org_new", returnTo: "/brain" },
});
```

Add runtime tests where `getAuth()` returns a verified user without
`organizationId`: successful onboarding calls Convex with the switched token;
failed onboarding returns `setupFailure`; an existing organization claim
bypasses WorkOS onboarding.

- [ ] **Step 3: Run tests and verify RED**

```sh
rtk host-test-slot --class focused pnpm --dir apps/web exec vitest run src/auth/workos-agency-adapter.test.ts src/auth/authkit-server.test.ts
```

Expected: FAIL for missing adapter and runtime outcome.

- [ ] **Step 4: Implement WorkOS effects**

`createWorkosAgencyDependencies` must instantiate `new WorkOS(apiKey)`, map the
first page's `data`, treat WorkOS `NotFoundException` as `null` for external-ID
lookup, call native idempotent organization creation, call membership creation
without assigning an elevated WorkOS role, and delegate session switching to the
injected AuthKit function.

Do not log errors or response bodies. Do not import the worker subpath; the
package's `workerd` export condition selects it during the Cloudflare build.

- [ ] **Step 5: Integrate runtime**

Extend the server auth user shape with `emailVerified`, `name`, `firstName`, and
`lastName`. Change missing organization from immediate `Unauthorized` to the
onboarding path. Preserve strict rejection for missing user ID, email, session
ID, or access token.

After a successful switch, call:

```ts
await provisionWorkspace(onboarding.accessToken);
return {
  authSnapshot: {
    status: "authenticated",
    subject: auth.user.id,
    email: auth.user.email,
    organizationId: onboarding.organizationId,
    sessionId: auth.sessionId,
  },
  workspaceRuntimeMode: config.mode,
};
```

On safe failure return:

```ts
return {
  authSnapshot: { status: "setupFailure", reason: onboarding.reason },
  workspaceRuntimeMode: config.mode,
};
```

- [ ] **Step 6: Run focused tests and typecheck**

```sh
rtk host-test-slot --class focused pnpm --dir apps/web exec vitest run src/auth/agency-onboarding.test.ts src/auth/workos-agency-adapter.test.ts src/auth/authkit-server.test.ts
rtk tsc -p apps/web/tsconfig.json --noEmit
```

Expected: all focused tests pass and TypeScript reports no errors.

- [ ] **Step 7: Review and commit Task 2**

```sh
rtk git diff --check
rtk git add apps/web/package.json pnpm-lock.yaml apps/web/src/auth
rtk git commit -m "feat: provision agency for new WorkOS users"
```

Review: direct dependency only; provider calls server-only; switched token
precedes Convex; no arbitrary membership switch.

### Task 3: Recoverable setup UI and logout

**Files:**

- Create: `apps/web/src/features/setup/agency-setup-failure.tsx`
- Create: `apps/web/src/features/setup/agency-setup-failure.test.tsx`
- Create: `apps/web/src/routes/logout.tsx`
- Modify: `apps/web/src/routes/__root.tsx`
- Modify: `apps/web/src/auth/authkit-routes.test.ts`
- Generated: `apps/web/src/routeTree.gen.ts` through the repository route
  generator/build.

**Interfaces:**

- Consumes: `ClientAuthSnapshot` `setupFailure` reason.
- Produces: `AgencySetupFailure` and `/logout` route.

- [ ] **Step 1: Write failing UI and route tests**

Assert exact copy and semantics:

```tsx
const html = renderToStaticMarkup(
  <AgencySetupFailure reason="provider_failure" />,
);
expect(html).toContain("Agency setup couldn&#x27;t finish");
expect(html).toContain("Retry setup");
expect(html).toContain('href="/logout"');
expect(html).toContain('role="alert"');
expect(html).toContain("<main");
```

For `existing_membership`, assert only `Sign out` is offered and the
agency-access copy is present. Add route source assertions that `/logout`
imports and awaits AuthKit `signOut`.

- [ ] **Step 2: Run tests and verify RED**

```sh
rtk host-test-slot --class focused pnpm --dir apps/web exec vitest run src/features/setup/agency-setup-failure.test.tsx src/auth/authkit-routes.test.ts
```

Expected: FAIL for missing component and route.

- [ ] **Step 3: Implement the recovery surface**

Use a native `<main>`, focusable `<h1 tabIndex={-1}>`, stable `role="alert"`
text, native retry button that reloads the current safe URL, and
`<a href="/logout">Sign out</a>`. Do not mount workspace or Convex providers for
this state.

Add:

```ts
export const Route = createFileRoute("/logout")({
  loader: async () => {
    await signOut({ data: { returnTo: "/" } });
  },
});
```

In `RootComponent`, return the setup component before constructing
`WorkspaceRuntimeBoundary` when `authSnapshot.status === "setupFailure"`.

- [ ] **Step 4: Regenerate routes and run GREEN checks**

```sh
rtk pnpm --dir apps/web build
rtk host-test-slot --class focused pnpm --dir apps/web exec vitest run src/features/setup/agency-setup-failure.test.tsx src/auth/authkit-routes.test.ts src/auth/authkit-client.test.tsx src/providers/workspace-operations.test.ts
```

Expected: build and all focused tests pass; route tree includes `/logout`.

- [ ] **Step 5: Review and commit Task 3**

```sh
rtk git diff --check
rtk git add apps/web/src/features/setup apps/web/src/routes apps/web/src/routes/__root.tsx apps/web/src/routeTree.gen.ts apps/web/src/auth/authkit-routes.test.ts
rtk git commit -m "fix: recover organization-less WorkOS sessions"
```

Review keyboard order, focus behavior, announcements, copy, 320px reflow, and
the provider short-circuit.

### Task 4: Hosted acceptance, batch verification, and release

**Files:**

- Create: `tests/e2e/hosted-agency-signup.spec.ts`
- Modify only if required by test config: `playwright.config.ts`

**Interfaces:**

- Consumes: `TEMPLATE_HOSTED_URL`, `WORKOS_API_KEY`, `WORKOS_CLIENT_ID`,
  disposable email/password inputs, and the hosted app.
- Produces: release evidence for real zero-membership signup, hard reload, owner
  workspace, isolation, and WorkOS cleanup.

- [ ] **Step 1: Write the hosted test before deployment**

The test must create a unique WorkOS user with a generated password and no
memberships, sign in through `/sign-in?returnPathname=%2Fbrain`, wait for Agency
Brain, hard reload, assert no `Route unavailable`, and verify the active
workspace has owner controls. In `finally`, delete only the test membership,
deterministic organization, and user; do not mask the primary assertion failure
with cleanup failure.

- [ ] **Step 2: Run static/focused checks**

```sh
rtk prettier --check tests/e2e/hosted-agency-signup.spec.ts
rtk pnpm exec playwright test tests/e2e/hosted-agency-signup.spec.ts --list
```

Expected: formatting passes and Playwright compiles and lists the hosted test.
The hosted behavior test remains pending until deployment.

- [ ] **Step 3: Commit and freeze the batch head**

```sh
rtk git add tests/e2e/hosted-agency-signup.spec.ts playwright.config.ts
rtk git commit -m "test: cover hosted agency signup"
rtk git rev-parse HEAD
```

Record the exact SHA and make no further changes before whole-batch review.

- [ ] **Step 4: Run full required verification**

```sh
rtk maestro-remote-test -- pnpm verify
```

Expected: exit 0 on the exact frozen head.

- [ ] **Step 5: Whole-batch review**

Review `git diff 6b8f03ff...HEAD` against the design. Required verdict: Yes for
tenant isolation, WorkOS secret handling, idempotency, runtime short-circuit,
accessibility, and cleanup.

- [ ] **Step 6: Publish and pass CI**

Use `finishing-a-development-branch`: push `fix/self-service-agency-onboarding`,
open/refresh the PR to `main`, mark ready, and wait for
`ci/woodpecker/pr/verify` on the exact frozen SHA. Qlty remains advisory.

- [ ] **Step 7: Merge and deploy staging**

Merge only after required CI passes. Deploy Convex only if its generated/backend
output changed; deploy the Cloudflare Worker with BWS-backed credentials. Create
a successful GitHub staging deployment record naming the release SHA and worker
version.

- [ ] **Step 8: Remove the temporary incorrect membership**

Read WorkOS first and confirm `timkeen+test@gmail.com` has the operator-created
WRIP membership and no internal Brain authorization depending on it. Delete only
that membership. Do not modify the smoke account or any pre-existing membership.

- [ ] **Step 9: Run hosted fresh-signup acceptance**

```sh
rtk headless-bws-env exec zsh -lc 'export TEMPLATE_HOSTED_URL="https://maestro-brain-staging.tim-bb0.workers.dev"; rtk pnpm exec playwright test tests/e2e/hosted-agency-signup.spec.ts --project desktop-chromium --workers=1'
```

Expected: one passing test, no route error, owner workspace visible after hard
reload, cross-agency read denied, and test WorkOS objects removed.

- [ ] **Step 10: Final live checks**

Verify the staging deployment is `success`, unauthenticated `/brain` returns a
`307` to sign in, the merged main SHA matches the deployment, no acceptance
WorkOS artifacts remain, and the repository worktree is clean.
