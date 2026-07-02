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

**Tech Stack:** TypeScript, pnpm, Turbo, React, TanStack Start, TanStack Router,
TanStack Query, Vite, Cloudflare Pages today with a Cloudflare Workers decision
gate for Start SSR, Convex, Confect, Effect, `@confect/react`, `@confect/js`,
`@convex-dev/react-query`, WorkOS AuthKit for TanStack Start, Notion Kit, the
Maestro block layer, React Flow, Tailwind v4 theme bridge where ported from
Maestro, Playwright, Vitest, Buildkite, PostHog, Dodo, MailerSend,
OpenRouter-compatible LLMs, Scalar/OpenAPI, MCP.

---

## Completion Audit

Status: complete after the Phase 10 implementation commit
`00f210dd8 feat: complete phase 10 template primitives` and the follow-up
plan-reconciliation work. The remaining unchecked boxes in this file were stale
bookkeeping, plus a small set of real gaps that have now been filled:

- imported `docs/template/porting-backlog.md` and
  `docs/template/how-this-relates-to-maestro.md` from the backlog branch and
  updated them for the current hosted Notion-style app and vendored
  Effect/Confect repos;
- added the maturity model, do-not-port register, threat model, demo vertical,
  and the five named Effect/Confect agent pattern files;
- added named shared helper entrypoints for clock, nonce, base64url, and
  fingerprint helpers;
- added reusable settings and receipt frontend surfaces with focused tests;
- exposed the existing generator `intake` command as `pnpm template:intake`;
- fixed generator seed-fixture tests so they pass from the repo root.

Evidence commands run during reconciliation:

- `pnpm check:format`
- `pnpm check:docs-freshness`
- `pnpm check:generators`
- `pnpm check:route-tree`
- `pnpm template:intake -- --name "Reviewer Brain"`
- `pnpm exec vitest run apps/web/src/features/settings/settings-surface.test.ts apps/web/src/features/receipts/receipt-surface.test.ts apps/web/src/features/workflows/workflow-surface.test.ts apps/web/src/features/brain/brain-surface.test.ts`
- `pnpm exec vitest run packages/convex/test/shared-token-crypto.test.ts packages/convex/test/shared-clock-nonce.test.ts packages/convex/test/shared-env.test.ts packages/convex/test/shared-errors.test.ts`
- `pnpm exec vitest run tooling/generators/src/index.test.ts`
- `pnpm review:readiness`
- `pnpm review:completion`

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
- `/Users/headless/maestro/AGENTS.md`
- `/Users/headless/maestro/docs/superpowers/specs/2026-06-27-maestro-unified-frontend-system.md`
- `/Users/headless/maestro/docs/superpowers/plans/2026-06-28-canonical-nk-workspace-ui.md`
- `/Users/headless/maestro/docs/superpowers/specs/2026-06-27-workflow-builder-editor-ultimate-spec.md`
- `/Users/headless/maestro/docs/architecture/user-authored-workflows-execution-audit.md`
- `/Users/headless/maestro/docs/product/policy-is-data.md`
- `/Users/headless/maestro/docs/product/brain/ADR-001-brain-build-decisions.md`

## Opinionated Architecture Commitments

These choices are intentional and must survive every port. TanStack Start is a
frontend application/runtime commitment; it is not permission to replace the
backend, UI system, workflow model, provider seams, or deployment discipline.

Preserve this layer law:

```text
web routes -> screens -> features -> blocks -> Notion Kit
client hooks -> @confect/react refs -> Confect specs -> Convex functions
agents -> workflows -> capabilities -> domain/checks -> schema
API/CLI/MCP -> headless registry -> same capabilities/workflows as web
storage/notifications/observability -> Effect services -> provider adapters
admin/support/privacy -> audited capabilities -> narrow operator surfaces
```

Frontend commitments:

- Use TanStack Start, TanStack Router, and TanStack Query for route structure,
  route loaders, pending/error boundaries, typed search params, SSR/static
  integration, and router/query coordination.
- Keep the current hosted Vite/static reference app working until a TanStack
  Start migration has equivalent local static smoke, hosted smoke, browser
  smoke, visual baseline, and documented Cloudflare deployment behavior.
- Do not silently move the deployment target. Cloudflare Pages remains the
  current host for the static reference app; Cloudflare Workers or Start SSR
  requires an explicit deployment decision, env mapping, rollback path, and
  smoke coverage.
- Preserve the Notion Kit direction: `@notion-kit/ui` primitives,
  `@notion-kit/ui/style.css` through a scoped `notion.css`, Notion Kit sidebar
  primitives, `@notion-kit/settings-panel` for settings, lucide icons, and the
  Maestro/template block layer as the only place for reusable layout and visual
  grammar.
- Do not let routes or features hand-roll a second design system. Routes map
  URLs to screens; screens compose features; features adapt data; blocks render
  Notion-style UI and do not import Convex, Confect refs, route modules,
  provider SDKs, or auth internals.
- Preserve the calm investor document route. Production-like app surfaces should
  be separate routes or feature pages, not a return to a dense one-page
  dashboard.
- Use the exact Notion sidebar behavior from Maestro as the template target:
  Notion Kit `Sidebar`, `SidebarProvider`, `SidebarInset`, route/action/footer
  item adapters, grouped workspace navigation data, search trigger, settings
  footer, theme toggle, and mobile/collapsed behavior.

Backend and data commitments:

- Convex remains the backend substrate. Confect and Effect are the typed
  contract layer for new template backend work: Effect schemas, Confect
  specs/impls, typed expected errors, generated refs, generated services, HTTP
  APIs, and Scalar docs.
- `@confect/react` generated refs are the primary web data contract for Confect
  functions. `@convex-dev/react-query` and TanStack Query are cache/router
  integration tools; they must not duplicate business logic or replace Confect
  specs, generated refs, capability contracts, or Convex tenancy checks.
- TanStack Start server functions/loaders may handle route-level auth state,
  redirects, safe preloading, and SSR coordination. They must not become a
  second backend for business operations. Durable reads/writes, policy, billing,
  workflows, agents, and provider side effects stay behind Convex/Confect and
  Effect services.
- WorkOS AuthKit is the identity seam for production forks. The web root uses
  the AuthKit provider and Convex auth bridge; backend trust config lives in the
  Convex package; no WorkOS server secrets enter browser bundles.
- Provider SDKs stay behind adapters with fake/test/live-ready layers. WorkOS,
  PostHog, Dodo, MailerSend, OpenRouter-compatible LLMs, storage, search,
  notifications, and error reporting default fake/local until client setup.

Workflow, capability, agent, and Brain commitments:

- Workflows compose capabilities. Workflows do not call provider adapters
  directly.
- Agents are nondeterministic actors with explicit tool grants. Agents may call
  capabilities or start workflows; they do not call repos, provider adapters, or
  arbitrary Convex refs directly.
- Runtime-authored capabilities and workflows are data until promoted. Promotion
  to generated Confect source is the compile-time safety path.
- React Flow is the browser interaction layer for workflow authoring and
  inspection. Durable workflow graph schemas, validation, persistence,
  execution, provenance, and static headless exposure live outside React Flow.
- Reuse Maestro's
  `WorkflowGraph -> derived React Flow view -> command -> reducer -> validate -> Convex/Confect save/run`
  model. Do not introduce a second workflow schema, saved React Flow node/edge
  arrays, generic `data` bags, or arbitrary dynamic MCP tools per user-authored
  workflow.
- Policy is data. Product-tunable values, prompts, methodology, thresholds,
  model refs, and agent config live in validated/versioned policy rows.
  Workflows pin policy snapshots at kickoff and never read latest policy
  mid-run.
- The Brain remains source-backed and simple by default: markdown, links, notes,
  source sets, evidence snapshots/views, context packs, freshness, and trust
  receipts. RAG/vector search is an optional provider-backed extension, not the
  default truth model.

Coding, AI, testing, and operations commitments:

- Smarts live in models; code is plumbing. Free-form user intent goes to a
  tool-calling agent whose output is tool calls. Bounded semantic judgments are
  one model call through the LLM gateway returning a closed verdict.
  Deterministic rules, parsers, and regexes live in named `checks/*` modules.
- No dumping grounds: avoid `utils`, `helpers`, `misc`, and `common` directories
  for product logic. Put code under an explicit layer and name the boundary.
- No type escapes: no `any`, no `as unknown as`, no non-null assertions, and no
  `@ts-ignore`.
- No raw provider imports and no bare `process.env` in product code. Typed
  config decoders and Effect services own provider construction.
- New behavior gets behavior tests before implementation. Source-text-only tests
  are not proof.
- Use exact pinned compatibility sets for risky platform families: Confect,
  Effect, Convex, TanStack, WorkOS, Notion Kit, React Flow, provider SDKs, and
  Cloudflare tooling.
- Generated files are regenerated through package scripts, diffed, and never
  edited by hand.
- Every repeated review failure becomes a gate: lint rule, dependency boundary,
  deterministic quality check, debt metric, or documented CI ratchet.

Factory and starter commitments:

- The template is not just a source tree. It must be a repeatable client-fork
  machine with `template:init`, `template:doctor`, `template:upgrade`,
  `template:quickstart`, `template:seed-demo`, `template:handoff`,
  `template:add-*`, `template:promote-*`, private-package import, release
  artifacts, and handoff packets.
- The default quickstart must produce visible value in fake mode without live
  secrets: install, choose a blueprint, generate the instance, seed synthetic
  demo data, start the app, run the first workflow, inspect the Trust Receipt,
  and print next steps for provider setup.
- The default quickstart must be a loop, not a packet: generate instance, seed
  Brain, inspect context pack, run or inspect the first workflow, inspect the
  Trust Receipt, change one domain noun/capability/workflow, rerun fake doctor,
  and emit a handoff packet.
- A new AI/GTM implementation should start from a blueprint, not a blank fork.
  Blueprints define domain nouns, source types, initial Brain structure, first
  capabilities, first workflow, first agent grants, UI routes, headless
  surfaces, provider posture, eval fixtures, and demo data.
- Blueprint docs may describe planned packs, but generator help, quickstart
  docs, and reviewer docs must clearly label which blueprints are implemented.
  Do not imply a blueprint is executable until it has generator support,
  deterministic seed data, tests, and handoff docs.
- Blueprints are packages of opinion, not hardcoded business logic. They should
  make common B2B shapes fast while keeping client-specific nouns, prompts,
  integrations, and workflows isolated in generated modules or private packages.
- Generator output must be multi-surface by default: Confect specs/impls, Effect
  schemas, typed errors, tests, frontend adapter/view model when user-facing,
  headless registry entry when exposed, API/CLI/MCP docs, example fixture, audit
  metadata, data-map metadata, migration notes for durable changes, and reviewer
  docs.
- Client-specific code belongs in private packages or extension modules until
  reviewed and promoted. The template core remains generic.
- Client forks consume tagged template releases and upgrade through
  `template:upgrade` reports. Random file copying from template `main` is not a
  supported upgrade path.
- The best default GTM/AI fork proves one useful path end to end: client intake
  -> source-backed Brain -> context pack -> policy-pinned capability -> workflow
  run -> bounded agent turn -> Trust Receipt -> web/API/CLI/MCP access ->
  provider posture -> hosted smoke -> handoff packet.
- Quickstart docs must offer three paths:
- **10-minute local fake mode:** no secrets, one implemented blueprint, seeded
  demo data, local app, CLI workflow run or run inspection, Trust Receipt
  inspection, handoff preview.
  - **30-minute client discovery mode:** intake questionnaire, domain nouns,
    source inventory, integration shortlist, blueprint diff, generated
    implementation brief.
  - **One-day prototype mode:** configured fake/test providers, first custom
    capability/workflow, Notion-style route, headless operation, eval fixture,
    hosted smoke, and handoff packet.

Hard rules:

- Do not import from `repos/*`.
- Do not copy Maestro domain logic, client data, GTM-specific prompts,
  LinkedIn/harvest/campaign/ghostwriting/lead-magnet logic, real provider
  payloads, or customer names.
- Do translate reusable mechanics into generic template primitives.
- Do use Confect/Effect for backend ports unless the item is explicitly Node ops
  tooling or frontend-only UI.
- Do use TanStack Start as the frontend application framework. Route loading,
  route errors, pending states, search params, authenticated layouts, SSR/static
  deployment choices, and router/query integration should be expressed through
  TanStack Start conventions instead of an ad hoc router.
- Do not replace Confect/Convex backend contracts with TanStack server
  functions, raw fetch calls, route-local mutation handlers, or copied business
  logic.
- Do not replace Notion Kit, the block layer, the Notion sidebar, or the scoped
  Notion stylesheet with ad hoc React components or a different UI kit.
- Do not save or execute React Flow graphs as durable workflow data.
- Do not let generated client code bypass the layer law, Confect contracts,
  redaction policy, or private-package review path.
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
                -> Phase 8 TanStack Start + Notion Kit frontend vertical
                  -> Phase 9 app factory, quality gates, and ops hardening
                    -> Phase 10 broad reusable primitives
```

Do not start the workflow runner, agent runtime, co-editing system, or rich
frontend app shell before Phase 1 through Phase 4 are complete. Those systems
need typed errors, tenancy, provider services, policy snapshots, and prompt
provenance to be useful. TanStack Start migration planning may happen earlier,
but the real authenticated app shell should land after the backend access and
data contracts exist.

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
  repeatable client forks. The frontend is a TanStack Start app using the
  Maestro-style Notion Kit shell, route loaders, typed search params,
  `@confect/react` generated refs, Convex React Query cache integration where it
  fits, and designed route-level pending/error states.
- **L5 Production Client Fork:** Live provider credentials, real deploy
  promotion, retention/export/delete, observability, and security controls are
  provisioned for a specific client.

## Minimum AI/GTM Client Fork

A client fork is useful only when it can prove the implementation path, not just
render a starter UI. The first fork produced from this template must include:

- A `template-instance.json` manifest with app name, package scope, enabled
  blueprint, domains, environments, Convex deployment mapping, provider posture,
  required secret names, enabled optional modules, and redaction status.
- A client-intake packet covering business goals, domain nouns, source types,
  workflows, integrations, billing posture, security posture, data lifecycle,
  and success metrics.
- A generated implementation brief that translates intake into selected
  blueprint, module list, first vertical, risks, provider setup, route map,
  headless surfaces, tests, and handoff criteria.
- A seeded fake-mode demo workspace that can be started locally without secrets
  and reset deterministically.
- A Day-0 factory loop that proves the fork can be renamed or lightly customized
  through generators without copying files by hand.
- One source-backed Brain path with markdown/links/notes, source set, evidence
  snapshot, context pack, freshness, and Trust Receipt.
- One policy-pinned capability with typed args, returns, expected errors,
  idempotency, audit metadata, eval fixture, and web/API/CLI/MCP exposure when
  appropriate.
- One persisted workflow run composed of capabilities, with stage/event rows,
  policy snapshot, evidence snapshot, timeout/retry posture, and receipt.
- One bounded agent turn with explicit tool grants and no arbitrary provider,
  repo, or Convex function access.
- A Notion-style Start app route for Brain, workflow, capability, settings, and
  receipt review, plus a calm investor/reviewer document route.
- Provider posture for WorkOS, PostHog, Dodo, MailerSend, LLM, storage/search,
  and notifications in fake/test/live-ready modes.
- A handoff packet naming what is real, fake, seam, or planned; what commands
  passed; what secrets are required; what deployment target is active; what
  migrations exist; and what live-provider swaps remain.

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
Convex provisioning story, frontend data/auth path, blueprint-first app factory
path, client handoff contract, release/upgrade story, and docs overclaim
cleanup.

**Files:**

- Create: `docs/template/porting-backlog.md`
- Create: `docs/template/how-this-relates-to-maestro.md`
- Create: `docs/template/porting-roadmap.md`
- Create: `docs/template/template-maturity-model.md`
- Create: `docs/template/do-not-port-register.md`
- Create: `docs/template/security-threat-model.md`
- Create: `docs/template/demo-vertical.md`
- Create: `docs/template/blueprint-catalog.md`
- Create: `docs/template/quickstart.md`
- Create: `docs/template/client-intake-questionnaire.md`
- Create: `docs/template/implementation-brief-template.md`
- Create: `docs/template/demo-seed-contract.md`
- Create: `docs/template/generator-output-contract.md`
- Create: `docs/template/client-handoff-packet.md`
- Create: `docs/template/template-release-process.md`
- Create: `docs/template/agent-worker-playbook.md`
- Modify: `docs/template/app-factory-guide.md`
- Modify: `docs/template/private-package-guide.md`
- Modify: `docs/template/client-fork-upgrade-guide.md`
- Modify: `AGENTS.md`
- Modify: `docs/template/investor-reviewer-packet.md`
- Modify: `docs/template/reviewer-guide.md`
- Modify: `docs/template/security.md`
- Modify: `docs/template/operations-runbook.md`
- Modify: `docs/rule-coverage.md`
- Modify: `tooling/release/src/index.ts`
- Test: `tooling/release/src/index.test.ts`
- Test: `tooling/quality/check-docs-freshness.test.mts`

### Task 0.1: Port The Backlog Doc Without Merging Old App Changes

- [x] Copy `docs/template/porting-backlog.md` from
      `origin/docs/template-clarity-and-porting-backlog`.
- [x] Keep the current Notion-style app, seed fixtures, and visual tests from
      `main`.
- [x] Add a header note that `docs/template/porting-roadmap.md` is the execution
      order and this backlog is the exhaustive inventory.
- [x] Run `pnpm check:format`.
- [x] Commit:

```bash
git add docs/template/porting-backlog.md
git commit -m "docs: add maestro porting backlog"
```

### Task 0.2: Port The Maestro Relationship Doc

- [x] Copy `docs/template/how-this-relates-to-maestro.md` from
      `origin/docs/template-clarity-and-porting-backlog`.
- [x] Update it to mention the current hosted Notion-style reference app and
      vendored Effect/Confect repos.
- [x] Verify it does not claim Maestro already uses Confect/Effect.
- [x] Run `pnpm check:format`.
- [x] Commit:

```bash
git add docs/template/how-this-relates-to-maestro.md
git commit -m "docs: explain maestro relationship"
```

### Task 0.3: Add The Maturity Model

- [x] Create `docs/template/template-maturity-model.md`.
- [x] Define L0 through L5 exactly as listed in this plan.
- [x] For each level, include required evidence files, required commands, and
      what an investor should infer.
- [x] Run `pnpm check:format`.
- [x] Commit:

```bash
git add docs/template/template-maturity-model.md
git commit -m "docs: add template maturity model"
```

### Task 0.4: Add The Execution Roadmap

- [x] Create `docs/template/porting-roadmap.md`.
- [x] Include the dependency map from this plan.
- [x] Map backlog sections to phases:
  - Phase 1: B, M, Confect/Effect pattern docs.
  - Phase 2: A, R, H seat-count dependency.
  - Phase 3: C, H minimum usage, G API auth minimum, S env manifest.
  - Phase 4: D, I audit/migrations minimum, P prompt/knowledge minimum.
  - Phase 5: G capability registry minimum, I knowledge-source minimum, J eval
    minimum.
  - Phase 6: F workflow minimum, P trust receipt projection.
  - Phase 7: E agent runtime minimum.
  - Phase 8: L frontend shell, Q visualize/act minimum, S UX/a11y minimum.
  - Phase 9: app-factory generator gates, K CI gates, S deploy/ops/security.
  - Phase 10: N, O, P, Q broad primitives and blueprint expansion.
- [x] Add a "do not start yet" section for BlockNote/ProseMirror, full workflow
      schedules, and app-wide dashboards until earlier phases are complete.
- [x] Run `pnpm check:format`.
- [x] Commit:

```bash
git add docs/template/porting-roadmap.md
git commit -m "docs: add porting roadmap"
```

### Task 0.5: Add The Do-Not-Port Register

- [x] Create `docs/template/do-not-port-register.md`.
- [x] List prohibited source categories:
  - Maestro customer/client names.
  - Real prompt bodies.
  - Real provider payloads.
  - LinkedIn harvest/campaign/ghostwriting/lead-magnet-specific business logic.
  - Sales-call transcripts and private notes.
  - Production secrets, tokens, IDs, emails, webhook bodies.
- [x] Add allowed transformations:
  - Rename domain concepts into generic Brain/workflow/capability names.
  - Replace fixtures with synthetic `acme-demo` style data.
  - Keep algorithms and safety mechanics when they are domain-neutral.
- [x] Run `pnpm check:format`.
- [x] Commit:

```bash
git add docs/template/do-not-port-register.md
git commit -m "docs: add do-not-port register"
```

### Task 0.6: Add The Threat Model

- [x] Create `docs/template/security-threat-model.md`.
- [x] Cover these threats with mitigation and backlog link:
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
- [x] Run `pnpm check:format`.
- [x] Commit:

```bash
git add docs/template/security-threat-model.md
git commit -m "docs: add template threat model"
```

### Task 0.7: Define The First Demo Vertical

- [x] Create `docs/template/demo-vertical.md`.
- [x] Name the vertical `source-grounded-brief`.
- [x] Define the flow:
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
- [x] Define the non-goals:
  - No RAG by default.
  - No external publish side effect.
  - No broad agent autonomy.
  - No Maestro-specific GTM content.
- [x] Run `pnpm check:format`.
- [x] Commit:

```bash
git add docs/template/demo-vertical.md
git commit -m "docs: define first demo vertical"
```

### Task 0.8: Define The Starter, Blueprint, And Handoff Contract

- [x] Create `docs/template/blueprint-catalog.md`.
- [x] Include these initial blueprint families:
  - `source-grounded-gtm-brain`: a GTM/client-context app with sources, context
    packs, grounded briefs, workflow receipts, and headless access.
  - `implementation-consulting-brain`: a client implementation workspace with
    discovery intake, integration map, project workflows, risk register, and
    operator/admin surfaces.
  - `internal-ops-agent-workspace`: an internal workflow/agent system with
    tickets, approvals, notifications, and operational dashboards.
  - `custom-domain-ai-app`: the lowest-assumption path for a client-specific app
    with custom nouns and private packages.
- [x] For each blueprint, list domain nouns, source types, first capability,
      first workflow, first agent grants, required providers, optional
      providers, UI routes, headless surfaces, eval fixtures, demo data, and
      what must be deleted or renamed for a client fork.
- [x] Create `docs/template/quickstart.md` with three runnable paths: 10-minute
      local fake mode, 30-minute client discovery mode, and one-day prototype
      mode. Include exact commands, expected outputs, expected local URL, and
      the first files a worker should inspect.
- [x] Create `docs/template/client-intake-questionnaire.md` with sections for
      business objective, audience, source inventory, workflows, integrations,
      approvals, risk/compliance, billing/usage, reporting, launch path, and
      success metrics.
- [x] Create `docs/template/implementation-brief-template.md` showing the
      generated brief structure: selected blueprint, domain nouns, sources,
      workflows, capabilities, agents, integrations, provider posture, route
      map, headless surfaces, risks, tests, deploy path, and handoff criteria.
- [x] Create `docs/template/demo-seed-contract.md` defining fake-mode seed data:
      workspace, users, Brain sources, markdown notes, links, context packs,
      capability fixtures, workflow graphs, run receipts, provider posture,
      audit events, billing/events, and reset rules.
- [x] Create `docs/template/generator-output-contract.md` stating every
      `template:add-*` or `template:promote-*` command must emit or update:
      Confect spec/impl, Effect schema, typed errors, tests, fixtures, docs,
      frontend adapter/view model when user-facing, headless registry entry when
      exposed, audit metadata, data-map metadata, env manifest entries when
      needed, migration notes for durable changes, and reviewer commands.
- [x] Create `docs/template/client-handoff-packet.md` with the exact handoff
      checklist: status labels, commands run, hosted URL, deployment target,
      required secret names, provider posture, migrations, live-provider swaps,
      known seams, security notes, data lifecycle notes, and upgrade target.
- [x] Create `docs/template/template-release-process.md` explaining tagged
      template releases, release notes, `template:upgrade`, migration notes,
      private-package compatibility, and rollback.
- [x] Create `docs/template/agent-worker-playbook.md` explaining how future AI
      workers should navigate the repo, read vendored Effect/Confect sources,
      choose generators before hand-writing modules, follow the layer law, run
      focused checks, interpret fake/seam/planned labels, retrieve AI gate
      verdicts, and prepare handoff notes.
- [x] Update `AGENTS.md` so it links the blueprint catalog, generator output
      contract, client intake questionnaire, handoff packet, and worker
      playbook.
- [x] Update `docs/template/app-factory-guide.md`,
      `docs/template/private-package-guide.md`, and
      `docs/template/client-fork-upgrade-guide.md` to link these docs and make
      blueprint-first forks the default.
- [x] Run `pnpm check:format` and `pnpm check:docs-freshness`.
- [x] Commit:

```bash
git add AGENTS.md docs/template/blueprint-catalog.md docs/template/quickstart.md docs/template/client-intake-questionnaire.md docs/template/implementation-brief-template.md docs/template/demo-seed-contract.md docs/template/generator-output-contract.md docs/template/client-handoff-packet.md docs/template/template-release-process.md docs/template/agent-worker-playbook.md docs/template/app-factory-guide.md docs/template/private-package-guide.md docs/template/client-fork-upgrade-guide.md
git commit -m "docs: define app factory starter contract"
```

### Task 0.9: Reconcile Reviewer And Investor Docs

- [x] Update `docs/template/investor-reviewer-packet.md` so provider adapters
      are described as fake/test/live-ready seams unless the current code makes
      real SDK calls.
- [x] Update `docs/template/reviewer-guide.md` so the reviewer can inspect
      `docs/template/porting-backlog.md`, `docs/template/porting-roadmap.md`,
      and `docs/template/template-maturity-model.md`.
- [x] Update `docs/template/security.md` so claims like CSP, webhook
      verification, API keys, and support access are labeled as planned if not
      implemented.
- [x] Update `docs/template/operations-runbook.md` so deploy promotion,
      retention/export/delete, and alerting are labeled as planned unless wired.
- [x] Update `docs/rule-coverage.md` so fake-stub gates are not described as
      final enforcement.
- [x] Run `pnpm review:completion`.
- [x] Commit:

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

- [x] Read `repos/confect/apps/example/confect/notes_and_random/notes.spec.ts`.
- [x] Read `repos/confect/apps/example/confect/notes_and_random/notes.impl.ts`.
- [x] Read `repos/confect/apps/example/confect/workpool.spec.ts`.
- [x] Read `repos/effect/packages/effect/test/Schema/Class/TaggedError.test.ts`.
- [x] Read `repos/effect/packages/effect/test/Layer.test.ts`.
- [x] Create the five `agent-patterns/*` files listed above.
- [x] Each pattern file must include:
  - Read order.
  - Local template rules.
  - Good examples.
  - Things to avoid.
  - Verification commands.
- [x] Run `pnpm check:format`.
- [x] Commit:

```bash
git add agent-patterns
git commit -m "docs: add effect confect pattern notes"
```

### Task 1.2: Add Typed Env Access

- [x] Write failing tests in `packages/convex/test/shared-env.test.ts` for:
  - Missing live secret fails.
  - Whitespace secret fails.
  - Fake mode does not require live secret.
  - `LLM_DISABLED=true` enables the kill switch.
- [x] Create `packages/convex/confect/shared/env.ts` with:
  - `readRequiredEnv(name, env)`.
  - `readOptionalEnv(name, env)`.
  - `requireLiveEnv(names, mode, env)`.
  - `killSwitchOn(env)`.
  - Typed `EnvConfigError` with `Schema.TaggedError`.
- [x] Run `pnpm --dir packages/convex test shared-env`.
- [x] Commit:

```bash
git add packages/convex/confect/shared/env.ts packages/convex/test/shared-env.test.ts
git commit -m "feat: add typed env access"
```

### Task 1.3: Add Closed Public Error Catalog

- [x] Write failing tests in `packages/convex/test/shared-errors.test.ts` for:
  - Known error code is accepted.
  - Unknown error code is rejected at compile/runtime boundary.
  - Public error redacts internal details.
- [x] Create `packages/convex/confect/shared/errors.ts` with:
  - `ErrorCode` literal union.
  - `TemplatePublicError` as `Schema.TaggedError`.
  - `makePublicError`.
  - `redactUnknownError`.
- [x] Include codes for `UNAUTHENTICATED`, `NO_WORKSPACE_ACCESS`,
      `VALIDATION_FAILED`, `RATE_LIMITED`, `SPEND_CAP_EXCEEDED`, `LLM_DISABLED`,
      `PROVIDER_CONFIG_INVALID`, `POLICY_NOT_FOUND`, `PROMPT_NOT_FOUND`, and
      `INTERNAL`.
- [x] Run `pnpm --dir packages/convex test shared-errors`.
- [x] Commit:

```bash
git add packages/convex/confect/shared/errors.ts packages/convex/test/shared-errors.test.ts
git commit -m "feat: add closed public error catalog"
```

### Task 1.4: Add Crypto, Fingerprint, Clock, And Nonce Helpers

- [x] Write failing tests for base64url round-trip, HMAC signing, SHA-256
      hashing, constant-time comparison length mismatch, injected clock,
      injected nonce, and stable fingerprint.
- [x] Create the shared helper files listed above.
- [x] Use Web Crypto APIs only for code intended to run in Convex isolate
      contexts.
- [x] Make deterministic test seams explicit with injected `now` and `nonce`
      functions.
- [x] Run:

```bash
pnpm --dir packages/convex test shared-token-crypto
pnpm --dir packages/convex test shared-clock-nonce
```

- [x] Commit:

```bash
git add packages/convex/confect/shared packages/convex/test/shared-token-crypto.test.ts packages/convex/test/shared-clock-nonce.test.ts
git commit -m "feat: add shared crypto and deterministic seams"
```

### Task 1.5: Confirm Convex Component Wiring

- [x] Inspect `packages/convex/convex/convex.config.ts`.
- [x] Ensure required components for early phases are registered or documented
      in `docs/template/porting-roadmap.md`:
  - Workpool.
  - Workflow.
  - Rate limiter.
  - Migrations.
  - Agent.
  - ProseMirror sync when Phase 10 starts.
- [x] If a component is installed but unused, document the first phase that uses
      it.
- [x] Run `pnpm check:confect-compat`.
- [x] Commit:

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

- [x] Write tests for role ordering: `viewer < editor < admin < owner`.
- [x] Write tests for `roleAtLeast`, `capRole`, `highestRole`, and invalid role
      rejection.
- [x] Write tests for `normalizeEmail`, including whitespace, uppercase, invalid
      input, and blank input returning no verified email.
- [x] Implement `packages/convex/confect/access/roles.ts`.
- [x] Implement `packages/convex/confect/access/email.ts`.
- [x] Run focused tests.
- [x] Commit:

```bash
git add packages/convex/confect/access/roles.ts packages/convex/confect/access/email.ts packages/convex/test/access-roles.test.ts
git commit -m "feat: add tenancy role and email helpers"
```

### Task 2.2: Add Tenancy Tables

- [x] Add Confect tables for users, organizations, organization members,
      workspace members, guest grants, and invitations.
- [x] Add status fields needed for suspension/archive enforcement.
- [x] Add `deletedAt`, `revokedAt`, or `acceptedAt` fields where lifecycle
      requires single-live-row behavior.
- [x] Run `pnpm confect:codegen`.
- [x] Run `pnpm check:confect-contracts`.
- [x] Commit:

```bash
git add packages/convex/confect/tables packages/convex/confect/_generated packages/convex/convex/schema.ts
git commit -m "feat: add tenancy tables"
```

### Task 2.3: Add Effective Role Resolver

- [x] Write tests for direct membership, org admin baseline, guest grant,
      precedence tie-break, expired grant, revoked grant, suspended org,
      archived workspace, and duplicate live-row corruption.
- [x] Implement `packages/convex/confect/access/auth.ts` with:
  - `resolveRoleCandidates`.
  - `highestCandidate`.
  - `resolveEffectiveWorkspaceRole`.
  - `requireWorkspaceMember`.
  - `requireOrganizationMember`.
  - `assertOwningSide`.
- [x] Ensure handlers never trust caller-supplied workspace role.
- [x] Run `pnpm --dir packages/convex test access-effective-role`.
- [x] Commit:

```bash
git add packages/convex/confect/access/auth.ts packages/convex/test/access-effective-role.test.ts
git commit -m "feat: add effective workspace role resolver"
```

### Task 2.4: Add Idempotent Provisioning

- [x] Write tests for first sign-in, repeated sign-in, duplicate tombstoned
      rows, personal org creation, personal workspace creation, owner membership
      creation, and suspended user denial.
- [x] Implement Confect specs and impls for `ensureProvisioned`.
- [x] Add typed errors for unauthenticated, invalid identity, and provisioning
      conflict.
- [x] Run `pnpm confect:codegen`.
- [x] Run provisioning tests and Confect contract checks.
- [x] Commit:

```bash
git add packages/convex/confect/access/provisioning.ts packages/convex/confect/access/provisioning.spec.ts packages/convex/confect/access/provisioning.impl.ts packages/convex/confect/errors.ts packages/convex/confect/tables/workspaces.ts packages/convex/confect/_generated packages/convex/convex/access/provisioning.ts packages/convex/test/access-provisioning.test.ts
git commit -m "feat: add workspace provisioning"
```

### Task 2.5: Add Membership And Invitation Lifecycles

- [x] Write tests for role change, removal, ownership transfer, last-owner
      protection, guest cannot invite, invite accept exact email match, opaque
      invite denial, expiry, cancel, decline, and audit event emission.
- [x] Implement member and invitation Confect groups.
- [x] Add audit-event calls as soon as `recordAuditEvent` exists; until then
      write domain events into a local typed return and mark the table
      dependency in `docs/template/porting-roadmap.md`.
- [x] Run `pnpm confect:codegen`.
- [x] Run access tests.
- [x] Commit:

```bash
git add packages/convex/confect/access packages/convex/confect/_generated packages/convex/convex/access packages/convex/test/access-lifecycle.test.ts packages/convex/test/access-confect-groups.test.ts docs/template/porting-roadmap.md
git commit -m "feat: add member and invitation lifecycles"
```

### Task 2.6: Add Web Workspace Provider

- [x] Write React tests for loading, empty provisioning, active workspace
      persistence, workspace switching, and provisioning failure.
- [x] Implement `apps/web/src/providers/workspace.tsx`.
- [x] Add a small status surface to the sample/reference app only if it stays
      document-like and not dashboard-busy.
- [x] Run focused web Vitest coverage. Note: in this local environment,
      `pnpm --dir apps/web test` exits `1` with no output through the pnpm
      wrapper; direct
      `vitest run apps/web/src/providers/workspace.test.tsx     apps/web/src/sample/templateData.test.ts`
      passes.
- [x] Commit:

```bash
git add apps/web/src/providers/workspace.tsx apps/web/src/providers/workspace.test.tsx
git commit -m "feat: add workspace provider"
```

## Phase 3: Provider Gateway Minimum

**Purpose:** Make model calls and provider integrations safe, observable, and
fake-by-default.

**Backlog coverage:** C19-C31, G72-G78 minimum, H79-H82 minimum, S275-S276,
S281, S284-S285.

**Files:**

- Create: `packages/integrations/src/env.ts`
- Create: `packages/integrations/src/errors.ts`
- Create: `packages/integrations/src/llm.ts`
- Create: `packages/integrations/src/llmResponse.ts`
- Create: `packages/integrations/src/spend.ts`
- Create: `packages/integrations/src/rateLimit.ts`
- Create: `packages/integrations/src/workos.ts`
- Create: `packages/integrations/src/dodo.ts`
- Create: `packages/observability/src/posthog.ts`
- Create: `packages/observability/src/errorReporter.ts`
- Create: `packages/notifications/src/email.ts`
- Create: `packages/storage/src/objectStorage.ts`
- Create: `packages/convex/confect/tables/apiKeys.ts`
- Create: `packages/convex/confect/tables/billingPlans.ts`
- Create: `packages/convex/confect/tables/creditLedger.ts`
- Create: `packages/convex/confect/tables/usageEvents.ts`
- Create: `packages/convex/confect/headless/auth.ts`
- Create: `packages/convex/confect/headless/errorEnvelope.ts`
- Create: `docs/template/env-manifest.md`
- Test: `packages/integrations/src/llm.test.ts`
- Test: `packages/integrations/src/spend.test.ts`
- Test: `packages/integrations/src/rateLimit.test.ts`
- Test: `packages/integrations/src/workos.test.ts`
- Test: `packages/integrations/src/dodo.test.ts`
- Test: `packages/observability/src/posthog.test.ts`
- Test: `packages/notifications/src/email.test.ts`
- Test: `packages/storage/src/objectStorage.test.ts`
- Test: `packages/convex/test/headless-auth.test.ts`
- Test: `packages/convex/test/billing-ledger.test.ts`

### Task 3.1: Add Provider Env Manifest

- [x] Create `docs/template/env-manifest.md`.
- [x] List env vars for WorkOS, PostHog, Dodo, MailerSend, OpenRouter, storage,
      search, Cloudflare, Convex, and Buildkite.
- [x] For each env var, include owner, used by, fake-mode behavior, production
      requirement, and rotation note.
- [x] Add `.env.example` entries for non-secret names and explicit fake values
      such as `example.test`, `fake_local_key`, and `acme-demo`.
- [x] Extend `template:quickstart` so generated forks include
      `docs/template/generated/provider-setup-checklist.md` and an explicit next
      step pointing reviewers to provider setup.
- [x] Run `pnpm check:format`.
- [x] Commit:

```bash
git add docs/template/env-manifest.md .env.example
git commit -m "docs: add service env manifest"
```

### Task 3.2: Add Spend Estimator And Kill-Switch-Aware LLM Gateway

- [x] Write tests for conservative token estimate, cents floor, daily cap
      denial, `LLM_DISABLED`, fake completion, provider config error, redacted
      provider payload, and telemetry non-fatal failure.
- [x] Implement `packages/integrations/src/spend.ts`.
- [x] Implement `packages/integrations/src/llmResponse.ts`.
- [x] Implement `packages/integrations/src/llm.ts` with fake/test/live service
      modes.
- [x] Ensure no model instance is created outside this gateway.
- [x] Run `pnpm --dir packages/integrations test`.
- [x] Commit:

```bash
git add packages/integrations/src packages/integrations/src/*.test.ts
git commit -m "feat: add guarded llm gateway"
```

### Task 3.3: Add API-Key Auth And Error Envelope

- [x] Write tests for display-once API key creation, hashed key storage,
      bearer-key lookup, revoked key denial, workspace scope injection, and
      opaque public error envelopes.
- [x] Add `apiKeys` Confect table.
- [x] Implement `packages/convex/confect/headless/auth.ts` with API-key hash,
      scope, and revocation checks.
- [x] Implement `packages/convex/confect/headless/errorEnvelope.ts` so REST,
      CLI, and MCP surfaces share the same public error shape.
- [x] Run `pnpm confect:codegen`.
- [x] Run `pnpm --dir packages/convex test headless-auth`.
- [x] Commit:

```bash
git add packages/convex/confect/tables/apiKeys.ts packages/convex/confect/headless packages/convex/confect/_generated packages/convex/test/headless-auth.test.ts
git commit -m "feat: add headless api key auth"
```

### Task 3.4: Add Billing And Usage Ledger Minimum

- [x] Write tests for credit add, credit deduct, idempotent usage event,
      duplicate webhook denial, low-balance event, and seat-count preflight.
- [x] Add Confect tables for billing plans, credit ledger, and usage events.
- [x] Implement pure ledger helpers in `packages/integrations/src/spend.ts` or a
      focused billing module if the file grows too broad.
- [x] Add Dodo webhook verification seam in `packages/integrations/src/dodo.ts`
      with fake/test/live-ready modes.
- [x] Run `pnpm confect:codegen`.
- [x] Run billing and integrations tests.
- [x] Commit:

```bash
git add packages/convex/confect/tables/billingPlans.ts packages/convex/confect/tables/creditLedger.ts packages/convex/confect/tables/usageEvents.ts packages/convex/confect/_generated packages/integrations/src/dodo.ts packages/integrations/src/dodo.test.ts packages/convex/test/billing-ledger.test.ts
git commit -m "feat: add billing and usage ledger minimum"
```

### Task 3.5: Add WorkOS And AuthKit Seam

- [x] Write tests for required env validation, fake AuthKit client, live-ready
      route registration shape, signature failure classification, and Convex
      auth config derivation.
- [x] Implement `packages/integrations/src/workos.ts`.
- [x] Add or document `packages/convex/convex/auth.config.ts` generation for
      trusted AuthKit issuer/JWKS.
- [x] Update `docs/template/env-manifest.md` with WorkOS org and AuthKit values.
- [x] Run WorkOS tests.
- [x] Commit:

```bash
git add packages/integrations/src/workos.ts packages/integrations/src/workos.test.ts packages/convex/convex/auth.config.ts docs/template/env-manifest.md
git commit -m "feat: add workos auth seam"
```

### Task 3.6: Add Rate Limit And Usage Attribution Seams

- [x] Write tests for per-workspace limiter key, per-token limiter key, allowed
      result, denied result, and typed error mapping.
- [x] Implement a fake/test limiter interface first, with a clear adapter seam
      for `@convex-dev/rate-limiter`.
- [x] Add docs in `docs/template/porting-roadmap.md` stating when the real
      Convex component is wired.
- [x] Run `pnpm --dir packages/integrations test`.
- [x] Commit:

```bash
git add packages/integrations/src/rateLimit.ts packages/integrations/src/rateLimit.test.ts docs/template/porting-roadmap.md
git commit -m "feat: add provider rate limit seam"
```

### Task 3.7: Fill Observability, Notification, And Storage Packages

- [x] Add PostHog capture seam with non-fatal capture failures.
- [x] Add ErrorReporter interface with fake/test/live-ready implementations.
- [x] Add MailerSend-style email interface with idempotency key and redacted
      payload.
- [x] Add object-storage interface with signed upload/download URL shapes.
- [x] Write tests for each package.
- [x] Run:

```bash
pnpm --dir packages/observability test
pnpm --dir packages/notifications test
pnpm --dir packages/storage test
```

- [x] Commit:

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

- [x] Write tests for policy kind registration, invalid data rejection, merge
      behavior, nearest-wins scope resolution, and eval-required metadata.
- [x] Add `policies` table with append-only versioning and activation
      provenance.
- [x] Add policy kinds for spend limits, agent config, and prompt override.
- [x] Run `pnpm confect:codegen`.
- [x] Run policy tests.
- [x] Commit:

```bash
git add packages/convex/confect/tables/policies.ts packages/convex/confect/policy/kinds packages/convex/confect/_generated packages/convex/test/policy-kinds.test.ts
git commit -m "feat: add policy kind registry"
```

### Task 4.2: Add Policy Resolver And Snapshot Pinning

- [x] Write tests for system policy, workspace override, locale selection,
      pinned version lookup, inactive policy exclusion, and missing policy typed
      error.
- [x] Implement `packages/convex/confect/policy/resolver.ts`.
- [x] Add policy snapshot output shape for workflow kickoff.
- [x] Run `pnpm --dir packages/convex test policy-resolver`.
- [x] Commit:

```bash
git add packages/convex/confect/policy/resolver.ts packages/convex/test/policy-resolver.test.ts
git commit -m "feat: add policy resolver"
```

### Task 4.3: Add Prompt Registry And XML User Prompt Hardening

- [x] Write tests for `PromptRef` branding, immutable prompt version, prompt
      status, XML escaping, and no raw model id accepted by the gateway wrapper.
- [x] Add `promptRegistry` table.
- [x] Add `definePrompt`.
- [x] Add `xmlUserPrompt`.
- [x] Run `pnpm confect:codegen`.
- [x] Run prompt tests.
- [x] Commit:

```bash
git add packages/convex/confect/tables/promptRegistry.ts packages/convex/confect/policy/prompts packages/convex/confect/_generated packages/convex/test/prompt-registry.test.ts
git commit -m "feat: add prompt registry"
```

### Task 4.4: Add Idempotent System Seeder

- [x] Write tests for seeding default spend policy, default agent policy,
      default prompt family, and repeated seed no-op.
- [x] Implement `packages/convex/confect/policy/seed.ts`.
- [x] Add a CLI or script command only if it can run without live provider
      secrets. Decision: no CLI was added in this slice because the implemented
      artifact is a pure deterministic seed plan, not a persistence runner.
- [x] Run focused tests.
- [x] Commit:

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

- [x] Write a failing contract test for args, return value, and typed errors.
- [x] Add Confect spec for `sourceGroundedBrief`.
- [x] Args include `workspaceId`, `sourceIds`, `briefGoal`, `idempotencyKey`.
- [x] Return includes `briefMarkdown`, `sourceTitles`, `policySnapshotId`,
      `modelReceiptId`, and `trustClaim`.
- [x] Errors include unauthenticated, no workspace access, validation failed,
      policy not found, prompt not found, LLM disabled, rate limited, spend cap
      exceeded, and provider config invalid.
- [x] Run contract test and confirm it fails before impl.
- [x] Commit the failing contract only if the repo convention allows red commits
      in a feature branch; otherwise keep it local until implementation.

### Task 5.2: Implement Capability Domain And Fake LLM Path

- [x] Implement pure input normalization and context-pack formatting.
- [x] Implement fake LLM service path that returns deterministic markdown.
- [x] Persist no workflow state in this phase; return a typed capability result.
- [x] Run `pnpm confect:codegen`.
- [x] Run source-grounded brief tests.
- [x] Commit:

```bash
git add packages/convex/confect/capabilities/sourceGroundedBrief.* packages/convex/confect/_generated packages/convex/test/source-grounded-brief.test.ts
git commit -m "feat: add source grounded brief capability"
```

### Task 5.3: Expose Capability Through API, CLI, MCP, And OpenAPI

- [x] Add registry metadata in `packages/template-core/src/index.ts`.
- [x] Add CLI command in `apps/cli/src/index.ts`.
- [x] Add API/OpenAPI/MCP projection in `tooling/workflow/src/index.ts`.
- [x] Add tests proving the operation appears in describe, OpenAPI, CLI, and MCP
      tool manifests.
- [x] Run:

```bash
pnpm test:workflow
pnpm exec tsx apps/cli/src/index.ts describe
pnpm exec tsx apps/cli/src/index.ts api openapi
```

- [x] Commit:

```bash
git add packages/template-core/src/index.ts apps/cli/src/index.ts tooling/workflow/src/index.ts tooling/workflow/src/*.test.ts
git commit -m "feat: expose brief capability headlessly"
```

### Task 5.4: Add Eval Harness Case

- [x] Add synthetic eval cases under `examples/generic-ai-ops/evals/`.
- [x] Score groundedness, source citation presence, refusal on missing source,
      and policy compliance.
- [x] Add `tooling/evals/src/source-grounded-brief.test.ts`.
- [x] Run `pnpm evals`.
- [x] Commit:

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

- [x] Write tests for valid graph, missing start node, dangling edge, invalid
      retry config, invalid join, and invalid condition expression.
- [x] Add Confect tables for runs, stage runs, events, evidence snapshots, and
      context manifests.
- [x] Add pure graph validation in `workflows/graph.ts`.
- [x] Run `pnpm confect:codegen`.
- [x] Run graph tests.
- [x] Commit:

```bash
git add packages/convex/confect/tables/workflow*.ts packages/convex/confect/workflows/graph.ts packages/convex/confect/_generated packages/convex/test/workflow-graph.test.ts
git commit -m "feat: add workflow graph model"
```

### Task 6.2: Add Evidence Snapshot And Trust Receipt

- [x] Write tests for stable evidence hash, evidence snapshot materiality,
      context manifest reproducibility, and trust receipt projection.
- [x] Implement `evidence.ts` and `trustReceipt.ts`.
- [x] Use the fingerprint helper from Phase 1.
- [x] Run trust receipt tests.
- [x] Commit:

```bash
git add packages/convex/confect/workflows/evidence.ts packages/convex/confect/workflows/trustReceipt.ts packages/convex/test/trust-receipt.test.ts
git commit -m "feat: add workflow evidence and trust receipts"
```

### Task 6.3: Add Minimal Graph Runner

- [x] Write tests for a graph that calls `sourceGroundedBrief`, records stage
      status, records events, and produces a trust receipt.
- [x] Implement `runGraph.ts` with one supported node dispatch path first:
      capability node.
- [x] Keep provider calls inside capabilities, not workflows.
- [x] Run workflow run tests.
- [x] Commit:

```bash
git add packages/convex/confect/workflows/runGraph.ts packages/convex/test/workflow-run.test.ts
git commit -m "feat: add minimal workflow graph runner"
```

### Task 6.4: Wire Reference App To Real Run Shape

- [x] Update `packages/template-core/src/index.ts` so sample receipt fields
      mirror the persisted workflow run shape.
- [x] Update `apps/web/src/sample/App.tsx` copy only where needed to say the
      current reference app demonstrates the run shape.
- [x] Update Playwright expectations if text changes.
- [x] Run hosted browser and visual tests locally against preview.
- [x] Commit:

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

- [x] Write tests proving only public Confect refs can become model tools.
- [x] Add input schema, description, and optional presentation shaper per tool.
- [x] Include the `sourceGroundedBrief` capability as the first tool.
- [x] Run tests.
- [x] Commit:

```bash
git add packages/convex/confect/agents/defineTools.ts packages/convex/test/agent-tools.test.ts
git commit -m "feat: add typed agent tool surface"
```

### Task 7.2: Add Bounded Agent Runtime

- [x] Write tests for allowed tool call, denied tool grant, idempotency key
      reuse, fake model response, and typed error mapping.
- [x] Implement runtime with fake/test model first.
- [x] Use policy-driven agent config from Phase 4.
- [x] Run runtime tests.
- [x] Commit:

```bash
git add packages/convex/confect/agents/runtime.ts packages/convex/test/agent-runtime.test.ts
git commit -m "feat: add bounded agent runtime"
```

### Task 7.3: Add Assistant Entry Points

- [x] Add Confect spec/impl for `startThread`, `continueThread`, and
      `listThreadMessages`.
- [x] Ensure workspace access is re-verified.
- [x] Run `pnpm confect:codegen`.
- [x] Run agent tests and Confect contract checks.
- [x] Commit:

```bash
git add packages/convex/confect/agents/assistant.spec.ts packages/convex/confect/agents/assistant.impl.ts packages/convex/confect/_generated
git commit -m "feat: add assistant agent entrypoints"
```

## Phase 8: TanStack Start, Notion Kit, And Frontend Vertical

**Purpose:** Make the template feel like a buildable app, not only a reference
document, while preserving the Maestro frontend opinions: TanStack Start for the
app runtime, Notion Kit plus blocks for UI, Convex/Confect for data contracts,
React Flow only for workflow canvas interaction, and a calm hosted investor
document route.

**Backlog coverage:** L119-L137 minimum, Q219-Q236 minimum, S251-S270 minimum.

**Files:**

- Create: `docs/design-intake/2026-07-01-template-frontend-stack-source.md`
- Create: `docs/template/frontend-architecture.md`
- Modify: `docs/template/hosting.md`
- Modify: `docs/template/repo-map.md`
- Modify: `docs/template/investor-reviewer-packet.md`
- Modify: `apps/web/package.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `apps/web/src/start.ts`
- Create: `apps/web/src/router.tsx`
- Create: `apps/web/src/routes/__root.tsx`
- Create: `apps/web/src/routes/_workspace.tsx`
- Create: `apps/web/src/routes/index.tsx`
- Generate: `apps/web/src/routeTree.gen.ts`
- Create: `apps/web/src/index.css`
- Create: `apps/web/src/notion.css`
- Modify: `apps/web/src/main.tsx` or replace it with the official TanStack Start
  entrypoint chosen in Task 8.0.
- Modify: `apps/web/src/sample/App.tsx`
- Modify: `apps/web/src/sample/styles.css`
- Modify: `packages/ui/src/index.tsx`
- Create: `packages/ui/src/blocks/*`
- Create: `packages/ui/src/shell/*`
- Create: `apps/web/src/navigation/workspace-config.ts`
- Create: `apps/web/src/navigation/workspace.ts`
- Create: `apps/web/src/adapters/env.ts`
- Create: `apps/web/src/adapters/workos-auth.ts`
- Create: `apps/web/src/adapters/workos-auth-loader.ts`
- Create: `apps/web/src/adapters/confect-state.ts`
- Create: `apps/web/src/providers/auth.tsx`
- Create: `apps/web/src/providers/workspace.tsx`
- Create: `apps/web/src/providers/posthog.tsx`
- Create: `apps/web/src/features/brain/*`
- Create: `apps/web/src/features/workflows/*`
- Create: `apps/web/src/features/receipts/*`
- Create: `apps/web/src/features/settings/*`
- Create: `apps/web/src/features/onboarding/*`
- Test: `apps/web/src/**/*.test.tsx`
- Test: `apps/web/src/**/*.test.ts`
- Test: `tests/e2e/hosted-reference-app.spec.ts`
- Test: `tests/e2e/hosted-reference-app.visual.spec.ts`

### Task 8.0: Write The Frontend Stack Source Audit And Deploy Decision

- [x] Create the design-intake doc mapping each target template primitive to the
      Maestro source file it came from: `apps/web/src/routes/__root.tsx`,
      `apps/web/src/router.tsx`, `apps/web/src/start.ts`,
      `apps/web/src/notion.css`, `apps/web/src/index.css`,
      `apps/web/src/components/shell/*`,
      `apps/web/src/navigation/workspace*.ts`,
      `apps/web/src/components/blocks/*`,
      `apps/web/src/features/settings/settings-dashboard.tsx`, and workflow
      canvas files.
- [x] Record that the current template host is a Vite static Cloudflare Pages
      app at `https://maestro-template.pages.dev`.
- [x] Decide the first TanStack Start deployment mode before code changes:
      static build on Cloudflare Pages if equivalent, or Cloudflare Workers SSR
      only with explicit env mapping, rollback command, and smoke tests.
- [x] List exact dependency families to add: `@tanstack/react-start`,
      `@tanstack/react-router`, `@tanstack/react-query`,
      `@tanstack/react-router-ssr-query`, `@convex-dev/react-query`,
      `@workos/authkit-tanstack-react-start`, `@notion-kit/ui`,
      `@notion-kit/settings-panel`, `@notion-kit/schemas`, lucide, Tailwind v4
      if the Maestro token bridge is ported, and any Notion Kit private tarball
      requiring explicit approval.
- [x] Update `docs/template/frontend-architecture.md` with the layer law,
      provider tree, Notion Kit/block rules, data-loading rules, deployment
      decision, quickstart frontend contract, and migration acceptance criteria.
- [x] Run `pnpm check:format` and `pnpm check:docs-freshness`.
- [x] Commit:

```bash
git add docs/design-intake/2026-07-01-template-frontend-stack-source.md docs/template/frontend-architecture.md docs/template/hosting.md docs/template/repo-map.md docs/template/investor-reviewer-packet.md
git commit -m "docs: record frontend stack source audit"
```

### Task 8.1: Add TanStack Start Runtime Without Breaking The Reference App

- [x] Add the TanStack, Convex React Query, WorkOS AuthKit Start, Notion Kit,
      and theme dependencies chosen in Task 8.0.
- [x] Add `apps/web/src/router.tsx` following Maestro's shape:
      `ConvexQueryClient`, `QueryClient`, generated `routeTree`,
      `setupRouterSsrQueryIntegration`, `defaultPreload: "intent"`,
      `scrollRestoration: true`, and no route-local business logic.
- [x] Add `apps/web/src/routes/__root.tsx` with the provider tree: WorkOS
      AuthKit provider, Convex auth bridge, PostHog provider, workspace
      provider, `HeadContent`, `Outlet`, and `Scripts`.
- [x] Keep the current investor reference document as its own route and verify
      the sidebar remains visible when navigating.
- [x] Generate `apps/web/src/routeTree.gen.ts`; do not edit it by hand.
- [x] Update `check:route-tree` if the generated route tree path or Start build
      output changes.
- [x] Run `pnpm --dir apps/web test`, `pnpm check:route-tree`, and
      `pnpm smoke:web-static`.
- [x] Commit:

```bash
git add apps/web package.json pnpm-lock.yaml tooling/quality docs/template
git commit -m "feat: add tanstack start web runtime"
```

### Task 8.2: Port The Notion Kit Shell, Sidebar, And Stylesheet Boundary

- [x] Replace the hand-rolled template sidebar target with the Maestro Notion
      Kit shell pattern: `SidebarProvider`, `Sidebar`, `SidebarHeader`,
      `SidebarContent`, `SidebarFooter`, `SidebarRail`, `SidebarInset`,
      `SidebarClose`, `SidebarOpen`, `Navbar`, and typed route/action/footer
      item adapters.
- [x] Add `apps/web/src/notion.css` importing `@notion-kit/ui/style.css` through
      the same scoped stylesheet strategy used by Maestro.
- [x] Add `apps/web/src/index.css` or a smaller template token bridge that keeps
      the Notion palette, sidebar vars, font stack, density, focus, motion, and
      workflow-node categorical colors without copying Maestro-specific product
      names.
- [x] Move reusable shell primitives into `packages/ui/src/shell/*` and reusable
      visual grammar into `packages/ui/src/blocks/*`. Feature code must compose
      these blocks rather than adding route-local layout systems.
- [x] Add navigation data under `apps/web/src/navigation/*` with generic
      template routes: Home, Brain, Workflows, Capabilities, Agents, Runs,
      Documents, Sources, Integrations, API, Onboarding, Data Map,
      Notifications, Settings, Billing, Analytics, Health, and Admin.
- [x] Use `@notion-kit/settings-panel` for settings surfaces and keep Notion
      settings primitives where possible.
- [x] Add tests proving the sidebar stays mounted on navigation, active route
      selection follows the route registry, grouped sections expand for active
      children, mobile/collapsed controls render, and the Notion stylesheet is
      loaded.
- [x] Run app tests and hosted visual smoke.
- [x] Commit:

```bash
git add apps/web/src packages/ui/src tests/e2e package.json pnpm-lock.yaml
git commit -m "feat: port notion kit app shell"
```

### Task 8.3: Add Shared Confect React Data-State Adapters

- [x] Add a small adapter layer over `@confect/react` and Convex React Query
      that normalizes query and mutation states into `skipped`, `loading`,
      `empty`, `ready`, `typed_failure`, `parse_failure`, `transport_failure`,
      and `defect`.
- [x] Keep the adapter generic and provider-free. It may understand Confect refs
      and typed errors; it must not know Brain, workflow, billing, or settings
      business logic.
- [x] Ensure route loaders only preload safe route data and auth state. Feature
      adapters remain responsible for converting backend contract data into view
      models.
- [x] Add type tests proving generated refs infer args, returns, typed failures,
      and mutation results through the adapter.
- [x] Add UI adapter tests for loading, empty, ready/read, ready/edit, skipped,
      mutation success, typed failure, transport failure, and parse failure.
- [x] Run `pnpm --dir apps/web test` and `pnpm check:layer-boundaries`.
- [x] Commit:

```bash
git add apps/web/src/adapters apps/web/src/features packages/ui/src
git commit -m "feat: add confect react state adapters"
```

### Task 8.4: Add Brain Source List And Context Pack Preview

- [x] Add Brain source list backed by typed sample data or Confect refs when
      available.
- [x] Add context pack preview with markdown, links, evidence snapshots,
      freshness, and no-default-RAG posture.
- [x] Add empty, loading, typed error, transport error, and parse error states
      through the shared Confect React adapter.
- [x] Preserve Brain doctrine in copy and code: source content is data, not
      instructions; RAG/vector search is optional; Trust Receipts carry the
      provenance.
- [x] Run app tests and browser smoke.
- [x] Commit:

```bash
git add apps/web/src/features/brain packages/ui/src tests/e2e
git commit -m "feat: add brain source surface"
```

### Task 8.5: Add Workflow Builder, Run, And Receipt Surface

- [x] Keep React Flow inside `packages/workflow-ui` and workflow feature
      surfaces only.
- [x] Add workflow graph view adapters that derive React Flow nodes/edges from
      durable workflow metadata. Do not persist React Flow nodes, edges,
      selection state, hover state, measured dimensions, or generic `data` bags.
- [x] Add a workflow run trigger using the fake/local path until the live
      Confect workflow ref is connected.
- [x] Add run status, stage list, evidence snapshot, policy snapshot, and Trust
      Receipt panel.
- [x] Add validation hints on graph nodes/edges only as a derived UI overlay.
- [x] Add tests for graph derivation, command reduction, validation-before-save,
      route rendering, reduced motion, and visual baselines.
- [x] Run `pnpm --dir packages/workflow-ui test`, app tests, browser smoke, and
      `pnpm check:workflow-graph-boundary`.
- [x] Commit:

```bash
git add packages/workflow-ui apps/web/src/features/workflows apps/web/src/features/receipts tests/e2e
git commit -m "feat: add workflow receipt surface"
```

### Task 8.6: Add Settings, Provider Health, Billing, And Onboarding Surfaces

- [x] Add settings with `@notion-kit/settings-panel`, workspace card, members
      card, integration health cards, billing/credits card, and fake/live-ready
      provider status.
- [x] Add onboarding surfaces for first workspace setup, sample Brain source
      import, first capability, first workflow, provider posture, and deploy
      readiness.
- [x] Keep WorkOS, PostHog, Dodo, MailerSend, storage, search, and LLM provider
      state behind adapters. The frontend renders provider posture; it does not
      construct provider SDK clients.
- [x] Add tests for admin vs non-admin settings, missing workspace, fake
      billing, provider warning states, and safe env rendering.
- [x] Run app tests and browser smoke.
- [x] Commit:

```bash
git add apps/web/src/features/settings apps/web/src/features/onboarding apps/web/src/providers packages/ui/src
git commit -m "feat: add settings and onboarding surfaces"
```

### Task 8.7: Add UX Essentials And Frontend Gates

- [x] Add network/offline banner, live-region helpers, skip link, and
      empty-state blocks.
- [x] Add toast provider, focus-return utilities, route pending surface, and
      route error surface.
- [x] Add reduced-motion behavior that disables React Flow animation and any
      nonessential shell transitions when requested.
- [x] Add Playwright accessibility smoke for desktop and mobile reference
      routes.
- [x] Add or update gates for Notion primitive usage, block-layer boundaries,
      route thinness, generated route tree freshness, text overflow, visual
      baselines, and CSS loaded checks.
- [x] Run app tests and browser smoke.
- [x] Run hosted smoke, visual smoke, and route/layer gates.
- [x] Commit:

```bash
git add apps/web/src packages/ui/src tests/e2e tooling/quality package.json pnpm-lock.yaml docs/rule-coverage.md
git commit -m "feat: add frontend ux safety primitives"
```

## Phase 9: Quality Gates, Deploy, Ops, And Security Hardening

**Purpose:** Replace fake-stub gates, make the app-factory commands trustworthy,
and make deployment/security claims real.

**Backlog coverage:** K96-K118, S271-S288, T app-factory/client-fork minimum.

**Files:**

- Modify: `package.json`
- Modify: `.buildkite/pipeline.yml`
- Create/modify: `.buildkite/scripts/*`
- Modify: `tooling/generators/src/index.ts`
- Modify: `tooling/generators/src/index.test.ts`
- Create: `tooling/generators/src/blueprints.ts`
- Create: `tooling/generators/src/quickstart.ts`
- Create: `tooling/generators/src/seedDemo.ts`
- Create: `tooling/generators/src/handoff.ts`
- Create: `project.config.json`
- Create: `scripts/doctor-deploy.mjs`
- Create: `scripts/smoke-deploy.mjs`
- Create: `scripts/sync-project-config.mjs`
- Create: `scripts/check-convex-production-env.mjs`
- Modify: `tooling/quality/*`
- Modify: `docs/template/app-factory-guide.md`
- Modify: `docs/template/generator-output-contract.md`
- Modify: `docs/template/client-handoff-packet.md`
- Modify: `docs/template/template-release-process.md`
- Modify: `docs/template/operations-runbook.md`
- Modify: `docs/template/security.md`
- Test: `tooling/quality/*.test.mts`
- Test: `tooling/generators/src/index.test.ts`
- Test: `tooling/release/src/index.test.ts`

### Task 9.1: Make App Factory Generators And Doctor Gateable

- [x] Add or harden tests for `template:init`, `template:doctor`,
      `template:quickstart`, `template:seed-demo`, `template:handoff`,
      `template:upgrade`, `template:private-package:dry-run`,
      `template:private-package:import`, `template:add-capability`,
      `template:add-workflow`, `template:promote-capability`, and
      `template:promote-workflow`.
- [x] Make blueprint status executable: generator-supported blueprints appear in
      CLI help and tests; planned blueprints remain clearly labeled in docs and
      are rejected with a useful error if requested.
- [x] Ensure `template:init` writes a complete `template-instance.json` with app
      name, package scope, blueprint, enabled modules, environments, provider
      posture, deployment targets, required secret names, redaction status, and
      source/demo-data posture.
- [x] Implement
      `template:quickstart -- --blueprint <name> --name <name>     [--write]` as
      an orchestration command that validates a blueprint, creates the instance
      manifest, writes the implementation brief, generates the first
      capability/workflow/agent metadata, seeds fake demo data, runs fake doctor
      checks, prints exact next commands, and proves the Day-0 loop by changing
      at least one domain noun/capability/workflow through generator output.
- [x] Implement `template:seed-demo -- --blueprint <name> [--reset] [--write]`
      so fake-mode demos are deterministic, redaction-safe, resettable, and
      covered by `docs/template/demo-seed-contract.md`.
- [x] Implement `template:handoff -- --mode fake|test|live` so the current
      instance emits a reviewer/client handoff packet with status labels,
      commands, hosted URL, provider posture, secret names, migrations, seams,
      and next work.
- [x] Add package scripts for `template:quickstart`, `template:seed-demo`, and
      `template:handoff`, and include them in CLI help output.
- [x] Ensure `template:doctor --mode fake` never requires live secrets and
      `template:doctor --mode live` reports missing secret names without
      printing values.
- [x] Ensure every add/promote generator follows
      `docs/template/generator-output-contract.md`: Confect contract files,
      tests, fixtures, docs, migration notes when durable, frontend adapter when
      user-facing, and headless registry metadata when exposed.
- [x] Ensure private-package import writes under `private-packages/<name>/`
      first, never promotes directly into template core, and emits redaction,
      ownership, migration, and contract-review notes.
- [x] Ensure `template:upgrade` reports changed packages, env var names,
      migrations, generated contract diffs, private-package compatibility, and
      manual review items.
- [x] Add `pnpm check:generators` coverage for the generator output contract and
      CLI help text.
- [x] Run `pnpm --dir tooling/generators test` and `pnpm check:generators`.
- [x] Commit:

```bash
git add tooling/generators docs/template/app-factory-guide.md docs/template/quickstart.md docs/template/generator-output-contract.md docs/template/client-handoff-packet.md docs/template/template-release-process.md docs/template/demo-seed-contract.md package.json
git commit -m "feat: harden app factory generators"
```

### Task 9.2: Replace Dependency And Type Gates

- [x] Replace fake-stub knip check with real knip config and command.
- [x] Replace fake-stub dependency-cruiser/layer check with real
      dependency-cruiser config.
- [x] Replace fake-stub type coverage with real `type-coverage --at-least 100`
      or a documented ratchet if 100 is not immediately reachable.
- [x] Keep current wrappers so `pnpm verify` remains stable.
- [x] Run `pnpm check:knip`, `pnpm check:layer-boundaries`, and
      `pnpm check:types-coverage`.
- [x] Commit:

```bash
git add package.json pnpm-lock.yaml tooling/quality
git commit -m "chore: replace dependency and type gates"
```

### Task 9.3: Add Coverage, Mutation, Secret, And Security Gates

- [x] Replace coverage ratchet with real Vitest coverage threshold.
- [x] Wire Stryker mutation testing for focused backend packages.
- [x] Confirm gitleaks runs with a real config and known canaries.
- [x] Add AST/static checks for auth demo bypass, joined-row workspace guard,
      HTTP fail-closed order, and public source-map blocking.
- [x] Run focused quality tests.
- [x] Commit:

```bash
git add tooling/quality package.json pnpm-lock.yaml .gitleaks.toml
git commit -m "chore: add real security and quality gates"
```

### Task 9.4: Add Deploy Source Of Truth And Promotion

- [x] Add `project.config.json` with staging and production environment names,
      domains, Cloudflare project names, Convex deploy names, and required env
      groups.
- [x] Add deploy doctor scripts that never print secret values.
- [x] Add Buildkite staging deploy and production promote steps that promote the
      exact staged SHA.
- [x] Run release tooling tests.
- [x] Commit:

```bash
git add project.config.json scripts .buildkite package.json tooling/release/src
git commit -m "chore: add deploy promotion tooling"
```

### Task 9.5: Add Security Headers, Health, Retention, And Alerts

- [x] Add HTTP security header helper for CSP, HSTS, X-Frame-Options, nosniff,
      and Referrer-Policy.
- [x] Add backend health/liveness Confect group.
- [x] Add retention/export/delete plan hooks and docs; implement only resources
      that currently exist.
- [x] Add outbound alert seam in `packages/notifications`.
- [x] Run tests and update docs from planned to real only for implemented
      pieces.
- [x] Commit:

```bash
git add packages/convex packages/notifications docs/template/security.md docs/template/operations-runbook.md
git commit -m "feat: add ops and security hardening"
```

### Task 9.6: Preserve AI-Driven CI And PR Workflow Discipline

- [x] Preserve Buildkite shape for deterministic gates, AI gates, staged deploy,
      and human production promotion.
- [x] Add or update checks for `taste`, `contract-review`, structured verdict
      extraction, unresolved review threads, PR health, merge conflicts,
      Graphite/stack wiring, and plan-required conventions if the template keeps
      those workflows.
- [x] Ensure AI gates fail closed when provider auth, parseable JSON verdicts,
      or Buildkite metadata are missing.
- [x] Ensure the repo docs explain how future workers retrieve AI gate verdicts
      and apply fixes without guessing.
- [x] Run Buildkite/tooling tests and `pnpm check:ci-completeness`.
- [x] Commit:

```bash
git add .buildkite tooling/quality tooling/stack tooling/workflow docs/template/operations-runbook.md docs/rule-coverage.md package.json
git commit -m "chore: preserve ai driven ci gates"
```

## Phase 10: Broad Reusable Primitives

**Purpose:** Expand from the first vertical into the full reusable app-factory
primitives.

**Backlog coverage:** N139-N175, O177-O191, P192-P218, Q219-Q236, remaining F,
remaining H, remaining S, T, and U.

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
9. **App factory subplan:** blueprint packs, client intake wizard,
   `template-instance.json` evolution, generator contracts, handoff packet
   generation, release artifacts, upgrade compatibility tests, and
   private-package promotion workflow.
10. **GTM implementation subplan:** account/person/source models, GTM-specific
    workflow examples, enrichment adapters, CRM/drive/Notion connector seams,
    reporting surfaces, and demo-safe fixtures that stay optional blueprint
    modules instead of template-core assumptions.

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
pnpm --dir tooling/generators test
pnpm build
pnpm template:quickstart -- --blueprint source-grounded-gtm-brain --name "Reviewer Brain"
pnpm template:seed-demo -- --blueprint source-grounded-gtm-brain
pnpm template:init -- --name "Reviewer Brain"
pnpm template:doctor -- --mode fake
pnpm template:add-capability -- --name summarizeSource
pnpm template:add-workflow -- --name sourceGroundedPlan
pnpm template:upgrade -- --from client-v1.0.0 --to template-v1.1.0
pnpm template:handoff -- --mode fake
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
| T. App factory/client forks     | Phase 0 docs, Phase 9 generator gates, Phase 10 factory subplan |
| U. GTM implementation packs     | Phase 0 blueprints, Phase 10 GTM implementation subplan         |
