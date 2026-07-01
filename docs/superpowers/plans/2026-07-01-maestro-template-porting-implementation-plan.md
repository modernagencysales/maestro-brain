# Maestro Template Porting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the Maestro template from a clear, hosted, investor-friendly
shell into a genuinely reusable private app factory with real Confect/Effect
backend slices, tenancy, provider gateways, workflows, agents, safety gates, and
frontend primitives.

**Architecture:** Port Maestro machinery as generic primitives, not Maestro
business logic. Backend ports are Confect/Effect translations: Effect schemas,
Confect specs/impls, typed errors, Effect services, and focused tests. Frontend
ports preserve the current calm Notion-style reference app while adding reusable
app-shell, workflow, Brain, editor, and operator primitives behind clear
boundaries.

**Tech Stack:** TypeScript, pnpm, Turbo, Convex, Confect, Effect, React, React
Flow, Playwright, Vitest, Buildkite, Cloudflare Pages/Workers, WorkOS, PostHog,
Dodo, MailerSend, OpenRouter-compatible LLMs, Scalar/OpenAPI, MCP.

---

## Source Material

Use these as the authoritative inputs:

- `docs/template/effect-confect-working-plan.md`
- `agent-patterns/effect-confect.md`
- `docs/template/porting-backlog.md` from branch
  `origin/docs/template-clarity-and-porting-backlog`
- `docs/template/how-this-relates-to-maestro.md` from branch
  `origin/docs/template-clarity-and-porting-backlog`
- `repos/effect/AGENTS.md`
- `repos/effect/packages/effect/test/`
- `repos/confect/CLAUDE.md`
- `repos/confect/apps/example/confect/`
- `repos/confect/packages/*/test/`

Hard rules:

- Do not import from `repos/*`.
- Do not copy Maestro domain logic, client data, GTM-specific prompts,
  LinkedIn/harvest/campaign/ghostwriting/lead-magnet logic, real provider
  payloads, or customer names.
- Do translate reusable mechanics into generic template primitives.
- Do use Confect/Effect for backend ports unless the item is explicitly Node ops
  tooling or frontend-only UI.
- Every subsystem doc must say whether the subsystem is `real`, `fake`, `seam`,
  or `planned`.

## Dependency Map

```text
Phase 0 docs truth
  -> Phase 1 Effect/Confect patterns and spine
    -> Phase 2 tenancy minimum
      -> Phase 3 provider gateway minimum
        -> Phase 4 policy/prompt minimum
          -> Phase 5 one real capability
            -> Phase 6 one real workflow run
              -> Phase 7 one bounded agent turn
                -> Phase 8 frontend vertical
                  -> Phase 9 quality gates and ops hardening
                    -> Phase 10 broad reusable primitives
```

Do not start the workflow runner, agent runtime, co-editing system, or rich
frontend app shell before Phase 1 through Phase 4 are complete. Those systems
need typed errors, tenancy, provider services, policy snapshots, and prompt
provenance to be useful.

## Completion Levels

Use these labels in docs and PR summaries:

- **L0 Hosted Shell:** Static reference app, fake providers, typed direction.
- **L1 Honest Template:** Backlog, maturity model, and docs clearly separate
  real code from seams.
- **L2 Guarded Backend Slice:** Real tenancy, env/crypto/errors, provider
  gateway, policy/prompt, and one capability.
- **L3 Workflow/Agent Slice:** One persisted workflow run and one bounded agent
  turn through typed tools.
- **L4 Client-App Factory:** Generator, frontend, CI, deploy, and docs support
  repeatable client forks.
- **L5 Production Client Fork:** Live provider credentials, real deploy
  promotion, retention/export/delete, observability, and security controls are
  provisioned for a specific client.

## Global Acceptance Criteria

Every phase must satisfy these criteria before the next phase starts:

- `pnpm check:format` passes.
- `pnpm lint` passes.
- `pnpm typecheck` passes.
- `pnpm build` passes.
- Focused tests for changed packages pass.
- `pnpm review:completion` either passes or is updated honestly to reflect the
  new evidence.
- Docs changed by the phase state the subsystem status as `real`, `fake`,
  `seam`, or `planned`.
- No application code imports from `repos/*`.
- No generated Confect or Convex files are hand-edited.

## Phase 0: Truthful Backlog, Roadmap, And Reviewer Docs

**Purpose:** Make the repo honest and executable before porting complex systems.

**Backlog coverage:** All sections A-S, plus the additional gaps identified
during review: dependency ordering, acceptance criteria, maturity model, threat
model, Confect/Effect playbooks, do-not-port register, demo vertical definition,
Convex provisioning story, frontend data/auth path, and docs overclaim cleanup.

**Files:**

- Create: `docs/template/porting-backlog.md`
- Create: `docs/template/how-this-relates-to-maestro.md`
- Create: `docs/template/porting-roadmap.md`
- Create: `docs/template/template-maturity-model.md`
- Create: `docs/template/do-not-port-register.md`
- Create: `docs/template/security-threat-model.md`
- Create: `docs/template/demo-vertical.md`
- Modify: `docs/template/investor-reviewer-packet.md`
- Modify: `docs/template/reviewer-guide.md`
- Modify: `docs/template/security.md`
- Modify: `docs/template/operations-runbook.md`
- Modify: `docs/rule-coverage.md`
- Modify: `tooling/release/src/index.ts`
- Test: `tooling/release/src/index.test.ts`
- Test: `tooling/quality/check-docs-freshness.test.mts`

### Task 0.1: Port The Backlog Doc Without Merging Old App Changes

- [ ] Copy `docs/template/porting-backlog.md` from
      `origin/docs/template-clarity-and-porting-backlog`.
- [ ] Keep the current Notion-style app, seed fixtures, and visual tests from
      `main`.
- [ ] Add a header note that `docs/template/porting-roadmap.md` is the execution
      order and this backlog is the exhaustive inventory.
- [ ] Run `pnpm check:format`.
- [ ] Commit:

```bash
git add docs/template/porting-backlog.md
git commit -m "docs: add maestro porting backlog"
```

### Task 0.2: Port The Maestro Relationship Doc

- [ ] Copy `docs/template/how-this-relates-to-maestro.md` from
      `origin/docs/template-clarity-and-porting-backlog`.
- [ ] Update it to mention the current hosted Notion-style reference app and
      vendored Effect/Confect repos.
- [ ] Verify it does not claim Maestro already uses Confect/Effect.
- [ ] Run `pnpm check:format`.
- [ ] Commit:

```bash
git add docs/template/how-this-relates-to-maestro.md
git commit -m "docs: explain maestro relationship"
```

### Task 0.3: Add The Maturity Model

- [ ] Create `docs/template/template-maturity-model.md`.
- [ ] Define L0 through L5 exactly as listed in this plan.
- [ ] For each level, include required evidence files, required commands, and
      what an investor should infer.
- [ ] Run `pnpm check:format`.
- [ ] Commit:

```bash
git add docs/template/template-maturity-model.md
git commit -m "docs: add template maturity model"
```

### Task 0.4: Add The Execution Roadmap

- [ ] Create `docs/template/porting-roadmap.md`.
- [ ] Include the dependency map from this plan.
- [ ] Map backlog sections to phases:
  - Phase 1: B, M, Confect/Effect pattern docs.
  - Phase 2: A, R, H seat-count dependency.
  - Phase 3: C, H minimum usage, S env manifest.
  - Phase 4: D, P prompt/knowledge minimum.
  - Phase 5: G capability registry minimum, J eval minimum.
  - Phase 6: F workflow minimum, P trust receipt projection.
  - Phase 7: E agent runtime minimum.
  - Phase 8: L frontend shell, Q visualize/act minimum, S UX/a11y minimum.
  - Phase 9: K CI gates, S deploy/ops/security.
  - Phase 10: N, O, P, Q broad primitives.
- [ ] Add a "do not start yet" section for BlockNote/ProseMirror, full workflow
      schedules, and app-wide dashboards until earlier phases are complete.
- [ ] Run `pnpm check:format`.
- [ ] Commit:

```bash
git add docs/template/porting-roadmap.md
git commit -m "docs: add porting roadmap"
```

### Task 0.5: Add The Do-Not-Port Register

- [ ] Create `docs/template/do-not-port-register.md`.
- [ ] List prohibited source categories:
  - Maestro customer/client names.
  - Real prompt bodies.
  - Real provider payloads.
  - LinkedIn harvest/campaign/ghostwriting/lead-magnet-specific business logic.
  - Sales-call transcripts and private notes.
  - Production secrets, tokens, IDs, emails, webhook bodies.
- [ ] Add allowed transformations:
  - Rename domain concepts into generic Brain/workflow/capability names.
  - Replace fixtures with synthetic `acme-demo` style data.
  - Keep algorithms and safety mechanics when they are domain-neutral.
- [ ] Run `pnpm check:format`.
- [ ] Commit:

```bash
git add docs/template/do-not-port-register.md
git commit -m "docs: add do-not-port register"
```

### Task 0.6: Add The Threat Model

- [ ] Create `docs/template/security-threat-model.md`.
- [ ] Cover these threats with mitigation and backlog link:
  - Cross-tenant data access.
  - Caller-supplied workspace identity.
  - Prompt injection through source content.
  - Webhook replay and signature confusion.
  - Provider payload leakage.
  - Public review-token leakage.
  - Support/admin overreach.
  - Spend abuse and runaway model calls.
  - Stale knowledge and ungrounded output.
  - Broken deploy/env cutover.
- [ ] Run `pnpm check:format`.
- [ ] Commit:

```bash
git add docs/template/security-threat-model.md
git commit -m "docs: add template threat model"
```

### Task 0.7: Define The First Demo Vertical

- [ ] Create `docs/template/demo-vertical.md`.
- [ ] Name the vertical `source-grounded-brief`.
- [ ] Define the flow:
  - Brain source set.
  - Context pack.
  - Prompt policy snapshot.
  - Fake/live-gated LLM completion.
  - Capability result.
  - Workflow run row.
  - Evidence snapshot.
  - Trust receipt.
  - API/CLI/MCP exposure.
  - Reference app page.
- [ ] Define the non-goals:
  - No RAG by default.
  - No external publish side effect.
  - No broad agent autonomy.
  - No Maestro-specific GTM content.
- [ ] Run `pnpm check:format`.
- [ ] Commit:

```bash
git add docs/template/demo-vertical.md
git commit -m "docs: define first demo vertical"
```

### Task 0.8: Reconcile Reviewer And Investor Docs

- [ ] Update `docs/template/investor-reviewer-packet.md` so provider adapters
      are described as fake/test/live-ready seams unless the current code makes
      real SDK calls.
- [ ] Update `docs/template/reviewer-guide.md` so the reviewer can inspect
      `docs/template/porting-backlog.md`, `docs/template/porting-roadmap.md`,
      and `docs/template/template-maturity-model.md`.
- [ ] Update `docs/template/security.md` so claims like CSP, webhook
      verification, API keys, and support access are labeled as planned if not
      implemented.
- [ ] Update `docs/template/operations-runbook.md` so deploy promotion,
      retention/export/delete, and alerting are labeled as planned unless wired.
- [ ] Update `docs/rule-coverage.md` so fake-stub gates are not described as
      final enforcement.
- [ ] Run `pnpm review:completion`.
- [ ] Commit:

```bash
git add docs/template/investor-reviewer-packet.md docs/template/reviewer-guide.md docs/template/security.md docs/template/operations-runbook.md docs/rule-coverage.md
git commit -m "docs: reconcile reviewer claims with backlog"
```

## Phase 1: Effect/Confect Spine And Pattern Library

**Purpose:** Build the shared primitives every backend port needs.

**Backlog coverage:** B11-B18, M138, and the pattern-file requirements from
`docs/template/effect-confect-working-plan.md`.

**Files:**

- Create: `agent-patterns/confect-spec-impl.md`
- Create: `agent-patterns/effect-schema-errors.md`
- Create: `agent-patterns/effect-services-layers.md`
- Create: `agent-patterns/confect-http-scalar.md`
- Create: `agent-patterns/confect-testing.md`
- Create: `packages/convex/confect/shared/env.ts`
- Create: `packages/convex/confect/shared/errors.ts`
- Create: `packages/convex/confect/shared/clock.ts`
- Create: `packages/convex/confect/shared/nonce.ts`
- Create: `packages/convex/confect/shared/base64Url.ts`
- Create: `packages/convex/confect/shared/tokenCrypto.ts`
- Create: `packages/convex/confect/shared/fingerprint.ts`
- Test: `packages/convex/test/shared-env.test.ts`
- Test: `packages/convex/test/shared-errors.test.ts`
- Test: `packages/convex/test/shared-token-crypto.test.ts`
- Test: `packages/convex/test/shared-clock-nonce.test.ts`

### Task 1.1: Create Local Effect/Confect Pattern Notes

- [ ] Read `repos/confect/apps/example/confect/notes_and_random/notes.spec.ts`.
- [ ] Read `repos/confect/apps/example/confect/notes_and_random/notes.impl.ts`.
- [ ] Read `repos/confect/apps/example/confect/workpool.spec.ts`.
- [ ] Read `repos/effect/packages/effect/test/Schema/Class/TaggedError.test.ts`.
- [ ] Read `repos/effect/packages/effect/test/Layer.test.ts`.
- [ ] Create the five `agent-patterns/*` files listed above.
- [ ] Each pattern file must include:
  - Read order.
  - Local template rules.
  - Good examples.
  - Things to avoid.
  - Verification commands.
- [ ] Run `pnpm check:format`.
- [ ] Commit:

```bash
git add agent-patterns
git commit -m "docs: add effect confect pattern notes"
```

### Task 1.2: Add Typed Env Access

- [ ] Write failing tests in `packages/convex/test/shared-env.test.ts` for:
  - Missing live secret fails.
  - Whitespace secret fails.
  - Fake mode does not require live secret.
  - `LLM_DISABLED=true` enables the kill switch.
- [ ] Create `packages/convex/confect/shared/env.ts` with:
  - `readRequiredEnv(name, env)`.
  - `readOptionalEnv(name, env)`.
  - `requireLiveEnv(names, mode, env)`.
  - `killSwitchOn(env)`.
  - Typed `EnvConfigError` with `Schema.TaggedError`.
- [ ] Run `pnpm --dir packages/convex test shared-env`.
- [ ] Commit:

```bash
git add packages/convex/confect/shared/env.ts packages/convex/test/shared-env.test.ts
git commit -m "feat: add typed env access"
```

### Task 1.3: Add Closed Public Error Catalog

- [ ] Write failing tests in `packages/convex/test/shared-errors.test.ts` for:
  - Known error code is accepted.
  - Unknown error code is rejected at compile/runtime boundary.
  - Public error redacts internal details.
- [ ] Create `packages/convex/confect/shared/errors.ts` with:
  - `ErrorCode` literal union.
  - `TemplatePublicError` as `Schema.TaggedError`.
  - `makePublicError`.
  - `redactUnknownError`.
- [ ] Include codes for `UNAUTHENTICATED`, `NO_WORKSPACE_ACCESS`,
      `VALIDATION_FAILED`, `RATE_LIMITED`, `SPEND_CAP_EXCEEDED`, `LLM_DISABLED`,
      `PROVIDER_CONFIG_INVALID`, `POLICY_NOT_FOUND`, `PROMPT_NOT_FOUND`, and
      `INTERNAL`.
- [ ] Run `pnpm --dir packages/convex test shared-errors`.
- [ ] Commit:

```bash
git add packages/convex/confect/shared/errors.ts packages/convex/test/shared-errors.test.ts
git commit -m "feat: add closed public error catalog"
```

### Task 1.4: Add Crypto, Fingerprint, Clock, And Nonce Helpers

- [ ] Write failing tests for base64url round-trip, HMAC signing, SHA-256
      hashing, constant-time comparison length mismatch, injected clock,
      injected nonce, and stable fingerprint.
- [ ] Create the shared helper files listed above.
- [ ] Use Web Crypto APIs only for code intended to run in Convex isolate
      contexts.
- [ ] Make deterministic test seams explicit with injected `now` and `nonce`
      functions.
- [ ] Run:

```bash
pnpm --dir packages/convex test shared-token-crypto
pnpm --dir packages/convex test shared-clock-nonce
```

- [ ] Commit:

```bash
git add packages/convex/confect/shared packages/convex/test/shared-token-crypto.test.ts packages/convex/test/shared-clock-nonce.test.ts
git commit -m "feat: add shared crypto and deterministic seams"
```

### Task 1.5: Confirm Convex Component Wiring

- [ ] Inspect `packages/convex/convex/convex.config.ts`.
- [ ] Ensure required components for early phases are registered or documented
      in `docs/template/porting-roadmap.md`:
  - Workpool.
  - Workflow.
  - Rate limiter.
  - Migrations.
  - Agent.
  - ProseMirror sync when Phase 10 starts.
- [ ] If a component is installed but unused, document the first phase that uses
      it.
- [ ] Run `pnpm check:confect-compat`.
- [ ] Commit:

```bash
git add packages/convex/convex/convex.config.ts docs/template/porting-roadmap.md
git commit -m "chore: document convex component prerequisites"
```

## Phase 2: Tenancy Minimum

**Purpose:** Make workspace access real, server-derived, and testable before
provider calls or workflow execution.

**Backlog coverage:** A1-A10, R237-R250, H245 seat dependency, S246 active
workspace dependency.

**Files:**

- Create: `packages/convex/confect/tables/users.ts`
- Create: `packages/convex/confect/tables/organizations.ts`
- Create: `packages/convex/confect/tables/organizationMembers.ts`
- Create: `packages/convex/confect/tables/workspaceMembers.ts`
- Create: `packages/convex/confect/tables/workspaceGuestGrants.ts`
- Create: `packages/convex/confect/tables/invitations.ts`
- Create: `packages/convex/confect/access/roles.ts`
- Create: `packages/convex/confect/access/email.ts`
- Create: `packages/convex/confect/access/auth.ts`
- Create: `packages/convex/confect/access/workspaces.spec.ts`
- Create: `packages/convex/confect/access/workspaces.impl.ts`
- Create: `packages/convex/confect/access/members.spec.ts`
- Create: `packages/convex/confect/access/members.impl.ts`
- Create: `packages/convex/confect/access/invitations.spec.ts`
- Create: `packages/convex/confect/access/invitations.impl.ts`
- Create: `apps/web/src/providers/workspace.tsx`
- Test: `packages/convex/test/access-roles.test.ts`
- Test: `packages/convex/test/access-effective-role.test.ts`
- Test: `packages/convex/test/access-provisioning.test.ts`
- Test: `packages/convex/test/access-invitations.test.ts`
- Test: `apps/web/src/providers/workspace.test.tsx`

### Task 2.1: Add Role Lattice And Email Normalizer

- [ ] Write tests for role ordering: `viewer < editor < admin < owner`.
- [ ] Write tests for `roleAtLeast`, `capRole`, `highestRole`, and invalid role
      rejection.
- [ ] Write tests for `normalizeEmail`, including whitespace, uppercase, invalid
      input, and blank input returning no verified email.
- [ ] Implement `packages/convex/confect/access/roles.ts`.
- [ ] Implement `packages/convex/confect/access/email.ts`.
- [ ] Run focused tests.
- [ ] Commit:

```bash
git add packages/convex/confect/access/roles.ts packages/convex/confect/access/email.ts packages/convex/test/access-roles.test.ts
git commit -m "feat: add tenancy role and email helpers"
```

### Task 2.2: Add Tenancy Tables

- [ ] Add Confect tables for users, organizations, organization members,
      workspace members, guest grants, and invitations.
- [ ] Add status fields needed for suspension/archive enforcement.
- [ ] Add `deletedAt`, `revokedAt`, or `acceptedAt` fields where lifecycle
      requires single-live-row behavior.
- [ ] Run `pnpm confect:codegen`.
- [ ] Run `pnpm check:confect-contracts`.
- [ ] Commit:

```bash
git add packages/convex/confect/tables packages/convex/confect/_generated packages/convex/convex/schema.ts
git commit -m "feat: add tenancy tables"
```

### Task 2.3: Add Effective Role Resolver

- [ ] Write tests for direct membership, org admin baseline, guest grant,
      precedence tie-break, expired grant, revoked grant, suspended org,
      archived workspace, and duplicate live-row corruption.
- [ ] Implement `packages/convex/confect/access/auth.ts` with:
  - `resolveRoleCandidates`.
  - `highestCandidate`.
  - `resolveEffectiveWorkspaceRole`.
  - `requireWorkspaceMember`.
  - `requireOrganizationMember`.
  - `assertOwningSide`.
- [ ] Ensure handlers never trust caller-supplied workspace role.
- [ ] Run `pnpm --dir packages/convex test access-effective-role`.
- [ ] Commit:

```bash
git add packages/convex/confect/access/auth.ts packages/convex/test/access-effective-role.test.ts
git commit -m "feat: add effective workspace role resolver"
```

### Task 2.4: Add Idempotent Provisioning

- [ ] Write tests for first sign-in, repeated sign-in, duplicate tombstoned
      rows, personal org creation, personal workspace creation, owner membership
      creation, and suspended user denial.
- [ ] Implement Confect specs and impls for `ensureProvisioned`.
- [ ] Add typed errors for unauthenticated, invalid identity, and provisioning
      conflict.
- [ ] Run `pnpm confect:codegen`.
- [ ] Run provisioning tests and Confect contract checks.
- [ ] Commit:

```bash
git add packages/convex/confect/access/workspaces.spec.ts packages/convex/confect/access/workspaces.impl.ts packages/convex/confect/_generated packages/convex/test/access-provisioning.test.ts
git commit -m "feat: add workspace provisioning"
```

### Task 2.5: Add Membership And Invitation Lifecycles

- [ ] Write tests for role change, removal, ownership transfer, last-owner
      protection, guest cannot invite, invite accept exact email match, opaque
      invite denial, expiry, cancel, decline, and audit event emission.
- [ ] Implement member and invitation Confect groups.
- [ ] Add audit-event calls as soon as `recordAuditEvent` exists; until then
      write domain events into a local typed return and mark the table
      dependency in `docs/template/porting-roadmap.md`.
- [ ] Run `pnpm confect:codegen`.
- [ ] Run access tests.
- [ ] Commit:

```bash
git add packages/convex/confect/access packages/convex/confect/_generated packages/convex/test/access-invitations.test.ts docs/template/porting-roadmap.md
git commit -m "feat: add member and invitation lifecycles"
```

### Task 2.6: Add Web Workspace Provider

- [ ] Write React tests for loading, empty provisioning, active workspace
      persistence, workspace switching, and provisioning failure.
- [ ] Implement `apps/web/src/providers/workspace.tsx`.
- [ ] Add a small status surface to the sample/reference app only if it stays
      document-like and not dashboard-busy.
- [ ] Run `pnpm --dir apps/web test`.
- [ ] Commit:

```bash
git add apps/web/src/providers/workspace.tsx apps/web/src/providers/workspace.test.tsx
git commit -m "feat: add workspace provider"
```

## Phase 3: Provider Gateway Minimum

**Purpose:** Make model calls and provider integrations safe, observable, and
fake-by-default.

**Backlog coverage:** C19-C31, H79-H82 minimum, S275-S276, S281, S284-S285.

**Files:**

- Create: `packages/integrations/src/env.ts`
- Create: `packages/integrations/src/errors.ts`
- Create: `packages/integrations/src/llm.ts`
- Create: `packages/integrations/src/llmResponse.ts`
- Create: `packages/integrations/src/spend.ts`
- Create: `packages/integrations/src/rateLimit.ts`
- Create: `packages/observability/src/posthog.ts`
- Create: `packages/observability/src/errorReporter.ts`
- Create: `packages/notifications/src/email.ts`
- Create: `packages/storage/src/objectStorage.ts`
- Create: `docs/template/env-manifest.md`
- Test: `packages/integrations/src/llm.test.ts`
- Test: `packages/integrations/src/spend.test.ts`
- Test: `packages/integrations/src/rateLimit.test.ts`
- Test: `packages/observability/src/posthog.test.ts`
- Test: `packages/notifications/src/email.test.ts`
- Test: `packages/storage/src/objectStorage.test.ts`

### Task 3.1: Add Provider Env Manifest

- [ ] Create `docs/template/env-manifest.md`.
- [ ] List env vars for WorkOS, PostHog, Dodo, MailerSend, OpenRouter, storage,
      search, Cloudflare, Convex, and Buildkite.
- [ ] For each env var, include owner, used by, fake-mode behavior, production
      requirement, and rotation note.
- [ ] Add `.env.example` entries for non-secret names and explicit fake values
      such as `example.test`, `fake_local_key`, and `acme-demo`.
- [ ] Run `pnpm check:format`.
- [ ] Commit:

```bash
git add docs/template/env-manifest.md .env.example
git commit -m "docs: add service env manifest"
```

### Task 3.2: Add Spend Estimator And Kill-Switch-Aware LLM Gateway

- [ ] Write tests for conservative token estimate, cents floor, daily cap
      denial, `LLM_DISABLED`, fake completion, provider config error, redacted
      provider payload, and telemetry non-fatal failure.
- [ ] Implement `packages/integrations/src/spend.ts`.
- [ ] Implement `packages/integrations/src/llmResponse.ts`.
- [ ] Implement `packages/integrations/src/llm.ts` with fake/test/live service
      modes.
- [ ] Ensure no model instance is created outside this gateway.
- [ ] Run `pnpm --dir packages/integrations test`.
- [ ] Commit:

```bash
git add packages/integrations/src packages/integrations/src/*.test.ts
git commit -m "feat: add guarded llm gateway"
```

### Task 3.3: Add Rate Limit And Usage Attribution Seams

- [ ] Write tests for per-workspace limiter key, per-token limiter key, allowed
      result, denied result, and typed error mapping.
- [ ] Implement a fake/test limiter interface first, with a clear adapter seam
      for `@convex-dev/rate-limiter`.
- [ ] Add docs in `docs/template/porting-roadmap.md` stating when the real
      Convex component is wired.
- [ ] Run `pnpm --dir packages/integrations test`.
- [ ] Commit:

```bash
git add packages/integrations/src/rateLimit.ts packages/integrations/src/rateLimit.test.ts docs/template/porting-roadmap.md
git commit -m "feat: add provider rate limit seam"
```

### Task 3.4: Fill Observability, Notification, And Storage Packages

- [ ] Add PostHog capture seam with non-fatal capture failures.
- [ ] Add ErrorReporter interface with fake/test/live-ready implementations.
- [ ] Add MailerSend-style email interface with idempotency key and redacted
      payload.
- [ ] Add object-storage interface with signed upload/download URL shapes.
- [ ] Write tests for each package.
- [ ] Run:

```bash
pnpm --dir packages/observability test
pnpm --dir packages/notifications test
pnpm --dir packages/storage test
```

- [ ] Commit:

```bash
git add packages/observability packages/notifications packages/storage
git commit -m "feat: add provider service package seams"
```

## Phase 4: Policy-As-Data And Prompt Registry Minimum

**Purpose:** Make model behavior configurable, versioned, and provenance-safe.

**Backlog coverage:** D32-D40, P199-P200 minimum, S279 seed dependency.

**Files:**

- Create: `packages/convex/confect/tables/policies.ts`
- Create: `packages/convex/confect/tables/promptRegistry.ts`
- Create: `packages/convex/confect/policy/kinds/types.ts`
- Create: `packages/convex/confect/policy/kinds/index.ts`
- Create: `packages/convex/confect/policy/kinds/spendLimits.ts`
- Create: `packages/convex/confect/policy/kinds/agent.ts`
- Create: `packages/convex/confect/policy/kinds/prompt.ts`
- Create: `packages/convex/confect/policy/prompts/types.ts`
- Create: `packages/convex/confect/policy/prompts/xmlUserPrompt.ts`
- Create: `packages/convex/confect/policy/resolver.ts`
- Create: `packages/convex/confect/policy/seed.ts`
- Test: `packages/convex/test/policy-kinds.test.ts`
- Test: `packages/convex/test/policy-resolver.test.ts`
- Test: `packages/convex/test/prompt-registry.test.ts`

### Task 4.1: Add Policy Kinds And Tables

- [ ] Write tests for policy kind registration, invalid data rejection, merge
      behavior, nearest-wins scope resolution, and eval-required metadata.
- [ ] Add `policies` table with append-only versioning and activation
      provenance.
- [ ] Add policy kinds for spend limits, agent config, and prompt override.
- [ ] Run `pnpm confect:codegen`.
- [ ] Run policy tests.
- [ ] Commit:

```bash
git add packages/convex/confect/tables/policies.ts packages/convex/confect/policy/kinds packages/convex/confect/_generated packages/convex/test/policy-kinds.test.ts
git commit -m "feat: add policy kind registry"
```

### Task 4.2: Add Policy Resolver And Snapshot Pinning

- [ ] Write tests for system policy, workspace override, locale selection,
      pinned version lookup, inactive policy exclusion, and missing policy typed
      error.
- [ ] Implement `packages/convex/confect/policy/resolver.ts`.
- [ ] Add policy snapshot output shape for workflow kickoff.
- [ ] Run `pnpm --dir packages/convex test policy-resolver`.
- [ ] Commit:

```bash
git add packages/convex/confect/policy/resolver.ts packages/convex/test/policy-resolver.test.ts
git commit -m "feat: add policy resolver"
```

### Task 4.3: Add Prompt Registry And XML User Prompt Hardening

- [ ] Write tests for `PromptRef` branding, immutable prompt version, prompt
      status, XML escaping, and no raw model id accepted by the gateway wrapper.
- [ ] Add `promptRegistry` table.
- [ ] Add `definePrompt`.
- [ ] Add `xmlUserPrompt`.
- [ ] Run `pnpm confect:codegen`.
- [ ] Run prompt tests.
- [ ] Commit:

```bash
git add packages/convex/confect/tables/promptRegistry.ts packages/convex/confect/policy/prompts packages/convex/confect/_generated packages/convex/test/prompt-registry.test.ts
git commit -m "feat: add prompt registry"
```

### Task 4.4: Add Idempotent System Seeder

- [ ] Write tests for seeding default spend policy, default agent policy,
      default prompt family, and repeated seed no-op.
- [ ] Implement `packages/convex/confect/policy/seed.ts`.
- [ ] Add a CLI or script command only if it can run without live provider
      secrets.
- [ ] Run focused tests.
- [ ] Commit:

```bash
git add packages/convex/confect/policy/seed.ts packages/convex/test/policy-seed.test.ts package.json
git commit -m "feat: add policy seed defaults"
```

## Phase 5: First Real Capability And Eval

**Purpose:** Prove the template can run one safe, observable model-backed
capability end to end.

**Backlog coverage:** G60-G78 minimum, J92-J94, C19-C24, D32-D40, P199-P200.

**Files:**

- Create: `packages/convex/confect/capabilities/sourceGroundedBrief.spec.ts`
- Create: `packages/convex/confect/capabilities/sourceGroundedBrief.impl.ts`
- Create: `packages/convex/confect/capabilities/sourceGroundedBrief.domain.ts`
- Create: `tooling/evals/src/source-grounded-brief.test.ts`
- Create: `examples/generic-ai-ops/evals/source-grounded-brief.cases.json`
- Modify: `packages/template-core/src/index.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `tooling/workflow/src/index.ts`
- Test: `packages/convex/test/source-grounded-brief.test.ts`

### Task 5.1: Define Capability Contract

- [ ] Write a failing contract test for args, return value, and typed errors.
- [ ] Add Confect spec for `sourceGroundedBrief`.
- [ ] Args include `workspaceId`, `sourceIds`, `briefGoal`, `idempotencyKey`.
- [ ] Return includes `briefMarkdown`, `sourceTitles`, `policySnapshotId`,
      `modelReceiptId`, and `trustClaim`.
- [ ] Errors include unauthenticated, no workspace access, validation failed,
      policy not found, prompt not found, LLM disabled, rate limited, spend cap
      exceeded, and provider config invalid.
- [ ] Run contract test and confirm it fails before impl.
- [ ] Commit the failing contract only if the repo convention allows red commits
      in a feature branch; otherwise keep it local until implementation.

### Task 5.2: Implement Capability Domain And Fake LLM Path

- [ ] Implement pure input normalization and context-pack formatting.
- [ ] Implement fake LLM service path that returns deterministic markdown.
- [ ] Persist no workflow state in this phase; return a typed capability result.
- [ ] Run `pnpm confect:codegen`.
- [ ] Run source-grounded brief tests.
- [ ] Commit:

```bash
git add packages/convex/confect/capabilities/sourceGroundedBrief.* packages/convex/confect/_generated packages/convex/test/source-grounded-brief.test.ts
git commit -m "feat: add source grounded brief capability"
```

### Task 5.3: Expose Capability Through API, CLI, MCP, And OpenAPI

- [ ] Add registry metadata in `packages/template-core/src/index.ts`.
- [ ] Add CLI command in `apps/cli/src/index.ts`.
- [ ] Add API/OpenAPI/MCP projection in `tooling/workflow/src/index.ts`.
- [ ] Add tests proving the operation appears in describe, OpenAPI, CLI, and MCP
      tool manifests.
- [ ] Run:

```bash
pnpm test:workflow
pnpm exec tsx apps/cli/src/index.ts describe
pnpm exec tsx apps/cli/src/index.ts api openapi
```

- [ ] Commit:

```bash
git add packages/template-core/src/index.ts apps/cli/src/index.ts tooling/workflow/src/index.ts tooling/workflow/src/*.test.ts
git commit -m "feat: expose brief capability headlessly"
```

### Task 5.4: Add Eval Harness Case

- [ ] Add synthetic eval cases under `examples/generic-ai-ops/evals/`.
- [ ] Score groundedness, source citation presence, refusal on missing source,
      and policy compliance.
- [ ] Add `tooling/evals/src/source-grounded-brief.test.ts`.
- [ ] Run `pnpm evals`.
- [ ] Commit:

```bash
git add examples/generic-ai-ops/evals tooling/evals/src/source-grounded-brief.test.ts
git commit -m "test: add source grounded brief eval"
```

## Phase 6: First Real Workflow Run

**Purpose:** Replace the deterministic receipt story with one persisted workflow
run and evidence/trust receipt path.

**Backlog coverage:** F44-F59 minimum, P216 trust receipt projection, O177-O191
change/version primitives as needed.

**Files:**

- Create: `packages/convex/confect/tables/workflowRuns.ts`
- Create: `packages/convex/confect/tables/workflowStageRuns.ts`
- Create: `packages/convex/confect/tables/workflowRunEvents.ts`
- Create: `packages/convex/confect/tables/workflowRunEvidenceSnapshots.ts`
- Create: `packages/convex/confect/tables/workflowRunContextManifests.ts`
- Create: `packages/convex/confect/workflows/graph.ts`
- Create: `packages/convex/confect/workflows/runGraph.ts`
- Create: `packages/convex/confect/workflows/evidence.ts`
- Create: `packages/convex/confect/workflows/trustReceipt.ts`
- Test: `packages/convex/test/workflow-graph.test.ts`
- Test: `packages/convex/test/workflow-run.test.ts`
- Test: `packages/convex/test/trust-receipt.test.ts`

### Task 6.1: Add Workflow Tables And Graph Model

- [ ] Write tests for valid graph, missing start node, dangling edge, invalid
      retry config, invalid join, and invalid condition expression.
- [ ] Add Confect tables for runs, stage runs, events, evidence snapshots, and
      context manifests.
- [ ] Add pure graph validation in `workflows/graph.ts`.
- [ ] Run `pnpm confect:codegen`.
- [ ] Run graph tests.
- [ ] Commit:

```bash
git add packages/convex/confect/tables/workflow*.ts packages/convex/confect/workflows/graph.ts packages/convex/confect/_generated packages/convex/test/workflow-graph.test.ts
git commit -m "feat: add workflow graph model"
```

### Task 6.2: Add Evidence Snapshot And Trust Receipt

- [ ] Write tests for stable evidence hash, evidence snapshot materiality,
      context manifest reproducibility, and trust receipt projection.
- [ ] Implement `evidence.ts` and `trustReceipt.ts`.
- [ ] Use the fingerprint helper from Phase 1.
- [ ] Run trust receipt tests.
- [ ] Commit:

```bash
git add packages/convex/confect/workflows/evidence.ts packages/convex/confect/workflows/trustReceipt.ts packages/convex/test/trust-receipt.test.ts
git commit -m "feat: add workflow evidence and trust receipts"
```

### Task 6.3: Add Minimal Graph Runner

- [ ] Write tests for a graph that calls `sourceGroundedBrief`, records stage
      status, records events, and produces a trust receipt.
- [ ] Implement `runGraph.ts` with one supported node dispatch path first:
      capability node.
- [ ] Keep provider calls inside capabilities, not workflows.
- [ ] Run workflow run tests.
- [ ] Commit:

```bash
git add packages/convex/confect/workflows/runGraph.ts packages/convex/test/workflow-run.test.ts
git commit -m "feat: add minimal workflow graph runner"
```

### Task 6.4: Wire Reference App To Real Run Shape

- [ ] Update `packages/template-core/src/index.ts` so sample receipt fields
      mirror the persisted workflow run shape.
- [ ] Update `apps/web/src/sample/App.tsx` copy only where needed to say the
      current reference app demonstrates the run shape.
- [ ] Update Playwright expectations if text changes.
- [ ] Run hosted browser and visual tests locally against preview.
- [ ] Commit:

```bash
git add packages/template-core/src/index.ts apps/web/src/sample/App.tsx tests/e2e
git commit -m "feat: align reference app with workflow run shape"
```

## Phase 7: First Bounded Agent Turn

**Purpose:** Prove agents can compose typed tools inside explicit grants without
broad system access.

**Backlog coverage:** E41-E43, D37 agent policy reader, G64 typed internal
capability map.

**Files:**

- Create: `packages/convex/confect/agents/defineTools.ts`
- Create: `packages/convex/confect/agents/runtime.ts`
- Create: `packages/convex/confect/agents/assistant.spec.ts`
- Create: `packages/convex/confect/agents/assistant.impl.ts`
- Test: `packages/convex/test/agent-tools.test.ts`
- Test: `packages/convex/test/agent-runtime.test.ts`

### Task 7.1: Add Typed Tool Surface

- [ ] Write tests proving only public Confect refs can become model tools.
- [ ] Add input schema, description, and optional presentation shaper per tool.
- [ ] Include the `sourceGroundedBrief` capability as the first tool.
- [ ] Run tests.
- [ ] Commit:

```bash
git add packages/convex/confect/agents/defineTools.ts packages/convex/test/agent-tools.test.ts
git commit -m "feat: add typed agent tool surface"
```

### Task 7.2: Add Bounded Agent Runtime

- [ ] Write tests for allowed tool call, denied tool grant, idempotency key
      reuse, fake model response, and typed error mapping.
- [ ] Implement runtime with fake/test model first.
- [ ] Use policy-driven agent config from Phase 4.
- [ ] Run runtime tests.
- [ ] Commit:

```bash
git add packages/convex/confect/agents/runtime.ts packages/convex/test/agent-runtime.test.ts
git commit -m "feat: add bounded agent runtime"
```

### Task 7.3: Add Assistant Entry Points

- [ ] Add Confect spec/impl for `startThread`, `continueThread`, and
      `listThreadMessages`.
- [ ] Ensure workspace access is re-verified.
- [ ] Run `pnpm confect:codegen`.
- [ ] Run agent tests and Confect contract checks.
- [ ] Commit:

```bash
git add packages/convex/confect/agents/assistant.spec.ts packages/convex/confect/agents/assistant.impl.ts packages/convex/confect/_generated
git commit -m "feat: add assistant agent entrypoints"
```

## Phase 8: Frontend Vertical

**Purpose:** Make the template feel like a buildable app, not only a reference
document, while keeping the reference app calm.

**Backlog coverage:** L119-L137 minimum, Q219-Q236 minimum, S251-S270 minimum.

**Files:**

- Create: `apps/web/src/providers/auth.tsx`
- Create: `apps/web/src/providers/workspace.tsx`
- Create: `apps/web/src/routes/router.tsx`
- Create: `apps/web/src/components/blocks/*`
- Create: `apps/web/src/features/brain/*`
- Create: `apps/web/src/features/workflows/*`
- Create: `apps/web/src/features/receipts/*`
- Create: `apps/web/src/features/settings/*`
- Modify: `apps/web/src/sample/App.tsx`
- Test: `apps/web/src/**/*.test.tsx`
- Test: `tests/e2e/hosted-reference-app.spec.ts`
- Test: `tests/e2e/hosted-reference-app.visual.spec.ts`

### Task 8.1: Add App Shell Without Re-busying The Reference Pages

- [ ] Add route registry, sidebar registry, error surface, pending surface, skip
      link, and live region.
- [ ] Keep the investor reference pages as a calm document route.
- [ ] Add tests for loading, empty, ready/read, ready/edit, mutation success,
      and mutation failure states.
- [ ] Run `pnpm --dir apps/web test`.
- [ ] Commit:

```bash
git add apps/web/src
git commit -m "feat: add reusable app shell"
```

### Task 8.2: Add Brain Source List And Context Pack Preview

- [ ] Add Brain source list backed by typed sample data or Confect refs when
      available.
- [ ] Add context pack preview with markdown, links, evidence, and
      no-default-RAG copy.
- [ ] Add empty state and error state.
- [ ] Run app tests and browser smoke.
- [ ] Commit:

```bash
git add apps/web/src/features/brain apps/web/src/components/blocks tests/e2e
git commit -m "feat: add brain source surface"
```

### Task 8.3: Add Workflow Run And Receipt Surface

- [ ] Add workflow run trigger button using fake/local path until live backend
      ref is connected.
- [ ] Add run status, stage list, evidence snapshot, and trust receipt panel.
- [ ] Add React Flow diagram only where it explains the run.
- [ ] Run visual tests and update snapshots.
- [ ] Commit:

```bash
git add apps/web/src/features/workflows apps/web/src/features/receipts tests/e2e
git commit -m "feat: add workflow receipt surface"
```

### Task 8.4: Add UX Essentials

- [ ] Add toast provider.
- [ ] Add network/offline banner.
- [ ] Add focus return utilities.
- [ ] Add reduced-motion hook that disables React Flow motion when requested.
- [ ] Add axe or Playwright accessibility smoke for the main reference pages.
- [ ] Run app tests and browser smoke.
- [ ] Commit:

```bash
git add apps/web/src tests/e2e package.json pnpm-lock.yaml
git commit -m "feat: add frontend ux safety primitives"
```

## Phase 9: Quality Gates, Deploy, Ops, And Security Hardening

**Purpose:** Replace fake-stub gates and make deployment/security claims real.

**Backlog coverage:** K96-K118, S271-S288.

**Files:**

- Modify: `package.json`
- Modify: `.buildkite/pipeline.yml`
- Create/modify: `.buildkite/scripts/*`
- Create: `project.config.json`
- Create: `scripts/doctor-deploy.mjs`
- Create: `scripts/smoke-deploy.mjs`
- Create: `scripts/sync-project-config.mjs`
- Create: `scripts/check-convex-production-env.mjs`
- Modify: `tooling/quality/*`
- Modify: `docs/template/operations-runbook.md`
- Modify: `docs/template/security.md`
- Test: `tooling/quality/*.test.mts`
- Test: `tooling/release/src/index.test.ts`

### Task 9.1: Replace Dependency And Type Gates

- [ ] Replace fake-stub knip check with real knip config and command.
- [ ] Replace fake-stub dependency-cruiser/layer check with real
      dependency-cruiser config.
- [ ] Replace fake-stub type coverage with real `type-coverage --at-least 100`
      or a documented ratchet if 100 is not immediately reachable.
- [ ] Keep current wrappers so `pnpm verify` remains stable.
- [ ] Run `pnpm check:knip`, `pnpm check:layer-boundaries`, and
      `pnpm check:types-coverage`.
- [ ] Commit:

```bash
git add package.json pnpm-lock.yaml tooling/quality
git commit -m "chore: replace dependency and type gates"
```

### Task 9.2: Add Coverage, Mutation, Secret, And Security Gates

- [ ] Replace coverage ratchet with real Vitest coverage threshold.
- [ ] Wire Stryker mutation testing for focused backend packages.
- [ ] Confirm gitleaks runs with a real config and known canaries.
- [ ] Add AST/static checks for auth demo bypass, joined-row workspace guard,
      HTTP fail-closed order, and public source-map blocking.
- [ ] Run focused quality tests.
- [ ] Commit:

```bash
git add tooling/quality package.json pnpm-lock.yaml .gitleaks.toml
git commit -m "chore: add real security and quality gates"
```

### Task 9.3: Add Deploy Source Of Truth And Promotion

- [ ] Add `project.config.json` with staging and production environment names,
      domains, Cloudflare project names, Convex deploy names, and required env
      groups.
- [ ] Add deploy doctor scripts that never print secret values.
- [ ] Add Buildkite staging deploy and production promote steps that promote the
      exact staged SHA.
- [ ] Run release tooling tests.
- [ ] Commit:

```bash
git add project.config.json scripts .buildkite package.json tooling/release/src
git commit -m "chore: add deploy promotion tooling"
```

### Task 9.4: Add Security Headers, Health, Retention, And Alerts

- [ ] Add HTTP security header helper for CSP, HSTS, X-Frame-Options, nosniff,
      and Referrer-Policy.
- [ ] Add backend health/liveness Confect group.
- [ ] Add retention/export/delete plan hooks and docs; implement only resources
      that currently exist.
- [ ] Add outbound alert seam in `packages/notifications`.
- [ ] Run tests and update docs from planned to real only for implemented
      pieces.
- [ ] Commit:

```bash
git add packages/convex packages/notifications docs/template/security.md docs/template/operations-runbook.md
git commit -m "feat: add ops and security hardening"
```

## Phase 10: Broad Reusable Primitives

**Purpose:** Expand from the first vertical into the full reusable app-factory
primitives.

**Backlog coverage:** N139-N175, O177-O191, P192-P218, Q219-Q236, remaining F,
remaining H, remaining S.

Split Phase 10 into separate subplans before implementation:

1. **Co-editing subplan:** documents, versions, annotations, ProseMirror sync,
   BlockNote, suggestion rail, agent co-edit tools.
2. **Versioning subplan:** generalized versioned entries, append-only restore,
   freshness side table, causation taxonomy, idempotent reconcile.
3. **Knowledge subplan:** concepts, claims, citations, evidence view, context
   pack builder, markdown codecs, OKF export.
4. **Transform subplan:** transformation definitions, traced transformation
   blocks, drift alerts, trust receipt projection.
5. **Visualize subplan:** data grid, Kanban, calendar, funnel, metric tiles,
   health board, lineage panel, diff view.
6. **Act subplan:** publish jobs, approval review gate, tokenized review links,
   refresh scheduler, trigger config, work queue, digests.
7. **Billing subplan:** credit ledger, entitlements, webhook dedup, usage
   events, seat enforcement.
8. **Frontend platform subplan:** i18n, localized emails, legal pages,
   notification center, command palette, PWA, onboarding.

Each subplan must live under `docs/superpowers/plans/` and include:

- Scope.
- Files.
- Tests.
- Acceptance criteria.
- Migration/provisioning impact.
- Which maturity level it advances.

## Master Verification Before Investor Review

Run these before showing the repo as a diligence artifact:

```bash
pnpm check:format
pnpm lint
pnpm typecheck
host-test-slot --class full pnpm test
pnpm test:tooling
pnpm build
pnpm review:readiness
pnpm review:completion
pnpm smoke:web-static
pnpm smoke:hosted
host-test-slot --class focused pnpm smoke:hosted:browser
host-test-slot --class focused pnpm smoke:hosted:visual
```

If a gate is intentionally fake, lightweight, or not yet wired, the reviewer
docs must say so. Passing a fake gate is not evidence for a production claim.

## Implementation Policy

- Commit after every task.
- Keep PRs phase-scoped.
- Prefer subagent-driven execution for independent tasks.
- Use inline execution only for tightly coupled tasks.
- Update docs in the same PR as code whenever a subsystem changes status.
- Do not let the reference app become a dense dashboard again; add real app
  surfaces as separate routes or feature pages.
- Keep the first production-like vertical narrow until L3 is complete.

## Coverage Matrix

| Backlog area                    | Plan phase                                                      |
| ------------------------------- | --------------------------------------------------------------- |
| A. Tenancy schema/helpers       | Phase 2                                                         |
| B. Env/crypto/errors            | Phase 1                                                         |
| C. Providers                    | Phase 3                                                         |
| D. Policy/prompt                | Phase 4                                                         |
| E. Agent runtime                | Phase 7                                                         |
| F. Workflow engine              | Phase 6                                                         |
| G. Capability/headless          | Phase 5                                                         |
| H. Billing/usage                | Phase 3 minimum, Phase 10 billing subplan                       |
| I. Knowledge/RAG                | Phase 5 minimum, Phase 10 knowledge subplan                     |
| J. Evals                        | Phase 5                                                         |
| K. Quality gates                | Phase 9                                                         |
| L. Frontend shell               | Phase 8                                                         |
| M. Convex components            | Phase 1                                                         |
| N. Co-editing                   | Phase 10 co-editing subplan                                     |
| O. Versioning                   | Phase 10 versioning subplan                                     |
| P. Knowledge/markdown/transform | Phase 4/5/6 minimum, Phase 10 knowledge and transform subplans  |
| Q. Visualize/act                | Phase 8 minimum, Phase 10 visualize and act subplans            |
| R. Tenancy lifecycle            | Phase 2                                                         |
| S. Starter-kit essentials       | Phase 8 and Phase 9 minimum, Phase 10 frontend platform subplan |
