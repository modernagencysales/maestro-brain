# Brain Real Alpha Launch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Agency Brain usable in real staging through
WorkOS-authenticated web and remote CLI paths.

**Architecture:** Deploy the existing TanStack Start server entry with
Cloudflare's Vite plugin, complete the installed AuthKit flow, reuse existing
Convex provisioning/Brain contracts, and add native-fetch execution to the
existing CLI.

**Tech Stack:** TypeScript, TanStack Start, WorkOS AuthKit, Cloudflare Workers,
Convex/Confect, Vitest, Playwright.

## Global Constraints

- No fake or demo identity in the hosted real-alpha path.
- Add no transport framework; use native `fetch`.
- Do not expose Brain writes through the CLI.
- Preserve unrelated changes and do not invoke Fabro.
- Use focused tests locally; broad verification runs remotely or under
  `host-test-slot`.

---

### Task 1: Pin the Cloudflare server deployment

**Files:**

- Modify: `apps/web/vite.config.ts`
- Create: `apps/web/wrangler.jsonc`
- Modify: `apps/web/package.json`
- Modify: `pnpm-lock.yaml`
- Test: `apps/web/src/cloudflare-deployment.test.ts`

**Interfaces:**

- Produces a Worker using `@tanstack/react-start/server-entry` and `dist/client`
  assets.

- [ ] Write a failing test that requires
      `cloudflare({ viteEnvironment: { name: "ssr" } })`, the TanStack server
      entry, `nodejs_compat`, and the client asset directory.
- [ ] Run
      `rtk host-test-slot --class focused pnpm --dir apps/web exec vitest run src/cloudflare-deployment.test.ts`
      and confirm the deployment assertions fail.
- [ ] Add `@cloudflare/vite-plugin` and `wrangler`, the minimal Vite plugin
      call, Worker config, and build/deploy scripts.
- [ ] Rerun the focused test and `rtk pnpm --dir apps/web typecheck`.

### Task 2: Complete AuthKit's required browser flow

**Files:**

- Create: `apps/web/src/routes/callback.tsx`
- Create: `apps/web/src/routes/sign-in.tsx`
- Modify: `apps/web/src/routes/__root.tsx`
- Modify: `apps/web/src/routeTree.gen.ts` through the normal route generator
- Test: `apps/web/src/auth/authkit-routes.test.ts`

**Interfaces:**

- Consumes the installed `handleCallbackRoute` and `getSignInUrl` functions.
- Produces `/callback`, `/sign-in`, and a signed-out live redirect.

- [ ] Write failing route registration/redirect tests.
- [ ] Run the focused tests and confirm the missing routes fail.
- [ ] Add the two server routes and redirect signed-out live requests before
      rendering workspace providers.
- [ ] Rebuild the route tree and rerun auth, route, and type checks.

### Task 3: Add the minimum remote Brain CLI

**Files:**

- Modify: `apps/cli/src/index.ts`
- Modify or create focused files under `apps/cli/src/` only when responsibility
  requires it.
- Modify: `apps/cli/src/index.test.ts`
- Modify: `apps/cli/package.json`

**Interfaces:**

- Consumes the existing `CONVEX_SITE_URL`, `MAESTRO_BRAIN_API_KEY`, and four
  reviewed operation IDs without adding a second backend URL concept.
- Produces `api call <operation-id> --input <json>` for those four read/Ask
  operations while preserving existing metadata commands.

- [ ] Write failing tests for request URL, Bearer header, JSON body, typed
      failures, network failures, and secret redaction.
- [ ] Run `rtk host-test-slot --class focused pnpm --dir apps/cli test` and
      confirm remote execution is absent.
- [ ] Implement the shortest native-fetch path and command parsing needed by
      those tests.
- [ ] Rerun CLI tests and typecheck; retain the existing rejection of Brain
      write operations.

### Task 4: Configure and launch real staging

**Files:**

- Modify only non-secret deployment docs/receipts if the verified state changes.

**Interfaces:**

- Produces one WorkOS organization, Cloudflare Worker deployment, configured
  Convex auth provider, provisioned user/Brain, and testable CLI credentials.

- [ ] Dry-run and deploy current Convex functions; confirm no index deletion.
- [ ] Configure WorkOS callback/sign-in/logout URLs and Cloudflare Worker
      secrets without printing values.
- [ ] Set Convex live auth variables and redeploy functions so `auth.config.ts`
      trusts the exact WorkOS issuer/JWKS/client tuple.
- [ ] Build and dry-run the Worker, then deploy it to staging.
- [ ] Run Playwright against `/brain`; require no route boundary, page error, or
      failed Convex query after sign-in.
- [ ] Complete submit, review, publish, edit, search, and citation assertions.
- [ ] Create a scoped read/Ask API key and run one CLI operation against the
      deployed Brain.
- [ ] Push the branch, verify current-head Woodpecker, and record the exact
      remaining no-go items rather than expanding scope.
