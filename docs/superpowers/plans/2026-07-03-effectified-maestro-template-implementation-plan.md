# Effectified Maestro Template Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking. After execution, preserve those
> checkboxes as the original implementation trace; the authoritative completion
> ledger lives in `docs/template/effectification-status.md`.

**Goal:** Convert `maestro-template` into an Effect/Confect-rooted application
template where schemas, typed errors, tenancy, headless surfaces, generators,
runtime services, and the optional BlockNote/Tiptap/ProseMirror editor substrate
are generated or derived from one contract family.

**Architecture:** Durable Convex tables stay in
`packages/convex/confect/tables/*`; public/internal/HTTP functions are Confect
specs and impls; typed errors cross boundaries through Effect error channels;
web/API/CLI/MCP surfaces derive from generated contract metadata instead of a
canned registry. Workflow work preserves the existing Maestro/template spine:
durable graph data, capability-only steps, `@convex-dev/workflow` replay,
stage/event/evidence/context ledgers, and Trust Receipts, then wraps it in
Confect v9 contracts instead of replacing it. Capability/workflow/agent
generators emit production-shaped Confect slices, tests, manifest metadata, and
docs from day one. Editor integration is exact-pinned, wrapped behind generic
template packages, and exposed through Confect/plain-Convex seams without
leaking product-specific Maestro code.

**Tech Stack:** TypeScript, pnpm, Turbo, Convex `1.42.1`, repo-pinned Confect
`9.1.5` after the v9 patch checkpoint below, Effect `3.21.4`, `@effect/vitest`,
`@confect/test`, `convex-test`, `@convex-dev/workflow` `0.4.4`, exact-pinned
editor packages after the version checkpoint, React `19.1.0`, the current
TanStack Router/Start shell under explicit evaluation, Vitest, fast-check,
dependency-cruiser.

---

## Source Citations

- Local repo rules: `AGENTS.md` requires Confect specs/impls, generated refs,
  typed errors, generated-file discipline, and use of
  `agent-patterns/effect-confect.md` before non-trivial Effect/Confect work.
- Local Effect/Confect patterns: `agent-patterns/effect-confect.md` points to
  Confect example specs/impls and Effect `Schema`, `Layer`, `Context`, and error
  tests.
- Confect v9 release notes:
  https://github.com/rjdellecese/confect/releases/tag/%40confect/core%409.0.0
  states that v9 emits one registry per group, uses filesystem-driven colocated
  `*.spec.ts`/`*.impl.ts` groups, makes tables filename-owned and lazy, changes
  `FunctionImpl.make`/`GroupImpl.make` to take generated `DatabaseSchema`,
  removes root aggregate specs/impls, improves React hook result stability, and
  recommends submodule Effect imports for cold-start savings.
- Confect typed errors: `repos/confect/packages/server/CHANGELOG.md:559-608`
  states `FunctionSpec` accepts an optional `error` schema, `FunctionImpl` may
  `Effect.fail`, and `@confect/test` surfaces decoded typed failures in the
  Effect error channel.
- Confect generated schema plus TestConfect:
  `repos/confect/packages/server/CHANGELOG.md:403-415` requires importing
  generated `confect/_generated/schema` and generated
  `confect/_generated/convexSchema` into `TestConfect.layer`;
  `repos/confect/packages/test/src/TestConfect.ts:258-271` shows the current
  layer signature.
- Confect introduction docs: https://confect.dev/getting-started/introduction
- Confect schema restriction docs:
  https://confect.dev/concepts/schema-restrictions
- Confect spec/impl model docs: https://confect.dev/concepts/spec-impl-model
- Confect services docs: https://confect.dev/concepts/services
- Effect `Schema.TaggedError`:
  `repos/effect/packages/effect/src/Schema.ts:8799-8880` and
  `repos/effect/packages/effect/test/Schema/Schema/Class/TaggedError.test.ts:7-120`.
- Effect `Effect.Service`:
  `repos/effect/packages/effect/src/Effect.ts:13550-13615`; official docs:
  https://effect.website/docs/requirements-management/services/
- Effect `Layer`: `repos/effect/packages/effect/test/Layer.test.ts:670-700`;
  official docs: https://effect.website/docs/requirements-management/layers/
- Effect config: `repos/effect/packages/effect/test/Config.test.ts:47-120`;
  official docs: https://effect.website/docs/configuration/
- Effect Clock and TestClock:
  `repos/effect/packages/effect/src/Clock.ts:22-111`,
  `repos/effect/packages/effect/test/TestClock.test.ts:5-34`, and
  `repos/effect/packages/effect/test/RateLimiter.test.ts:17-30`.
- Effect Schema annotations and JSON Schema docs:
  https://effect.website/docs/schema/annotations/ and
  https://effect.website/docs/schema/json-schema/
- Current template status: `docs/rule-coverage.md` classifies
  `check:confect-contracts` and `check:confect-compat` as pin-only;
  `packages/convex/test/confect-contracts.test.ts` checks generated refs and
  public-safe error encoding but does not run generated refs.
- Current v9 package state: `packages/convex/package.json`,
  `apps/web/package.json`, `apps/cli/package.json`, and
  `tooling/effectified-api-proof/package.json` pin Confect packages at `9.1.5`;
  the plan adds gates that keep v9 authoring rules from regressing.
- Current canned headless registry: `packages/template-core/src/index.ts`,
  `tooling/workflow/src/index.ts`, `packages/convex/confect/http.ts`, and
  `apps/cli/src/index.ts`.
- Current template workflow spine: `packages/convex/confect/workflows/graph.ts`
  defines durable graph schemas and typed validation errors;
  `packages/convex/confect/workflows/runGraph.ts` executes the current
  fake-first single capability graph;
  `packages/convex/confect/workflows/evidence.ts` and
  `packages/convex/confect/workflows/trustReceipt.ts` build stable
  evidence/context hashes and Trust Receipts;
  `packages/convex/test/workflow-graph.test.ts`,
  `packages/convex/test/workflow-run.test.ts`, and
  `packages/convex/test/trust-receipt.test.ts` prove the current contracts.
- Current template workflow guardrails:
  `tooling/eslint-plugin-template/rules/workflow-handler-determinism.mjs`
  forbids ambient time/random/IO/db/env inside `defineWorkflow(...).handler`,
  `tooling/eslint-plugin-template/rules/workflow-steps-are-capabilities.mjs`
  requires step calls to target `internal.capabilities.*`, and
  `tooling/eslint-plugin-template/rules/workflow-policy-snapshot.mjs` requires
  version-pinned policy reads.
- Maestro workflow prior art to preserve:
  `/Users/headless/maestro/packages/convex/convex/workflows/generatePost.ts`
  demonstrates durable staged workflows with `@convex-dev/workflow`,
  capability-only steps, retry policy, parent result projection, and best-effort
  observability failure handling;
  `/Users/headless/maestro/packages/convex/convex/adapters/workflowGraphRunner.ts`
  demonstrates a generic graph interpreter with capability-ref lookup,
  topological execution, condition evaluation, delay nodes, stage observability,
  and Convex JSON output;
  `/Users/headless/maestro/packages/convex/convex/capabilities/workflow/{runs,stages,runStatuses}.ts`
  and
  `/Users/headless/maestro/packages/convex/convex/repos/workflow/{runsRepo,stagesRepo,linksRepo}.ts`
  demonstrate workflow ownership, stage/event reads, status projection, and
  parent-child links.
- Maestro workflow canvas prior art to preserve:
  `/Users/headless/maestro/docs/superpowers/specs/2026-06-21-workflow-definitions-and-react-flow.md`
  defines React Flow as a visualization/editing layer over pure workflow graph
  data, with viewer/editor modes, capability catalog palette, status overlays
  from `workflowStageRuns`, and no arbitrary public capability dispatch.
  `/Users/headless/maestro/docs/superpowers/specs/2026-06-27-living-knowledge-workflows-v1.md`
  defines the product model flow
  `WorkflowGraph -> workflowGraphView() -> CanvasGraph -> React Flow interactions -> WorkflowGraphCommand -> applyWorkflowGraphChanges() -> validateWorkflowGraphForSave() -> Convex workflowTemplates.graph -> runGraph interpreter`.
- Maestro workflow UI source prior art to preserve:
  `/Users/headless/maestro/apps/web/src/features/workflows/workflow-canvas-state.ts`
  is a pure view-model with no React, Convex, or adapter imports; it converts
  domain workflow graphs into canvas nodes/edges, derives loading/empty/ready
  states, maps latest stage attempts to node status overlays, and derives detail
  panel state.
  `/Users/headless/maestro/apps/web/src/features/workflows/workflow-canvas-adapter.ts`
  owns graph sourcing, workspace lookup, Convex stage subscriptions, and status
  overlay application.
- `@convex-dev/workflow` package metadata checked on 2026-07-03: latest `0.4.4`;
  README states workflows are durable functions that can pause, sleep, await
  events, run steps sequentially or in parallel, be canceled/restarted, expose
  reactive status, and rely on deterministic handler replay.
- `confect-workflow` package metadata checked on 2026-07-03 from
  `npm view confect-workflow`: latest `0.0.0-alpha.3`, created 2026-03-20 and
  last modified 2026-03-25, description "`confect-workflow` integrates
  `@convex-dev/workflow` with Confect and Effect.", peer dependencies
  `@confect/core:^3.0.0`, `@confect/server:^3.0.0`,
  `@convex-dev/workflow:^0.3.7`, `convex:^1.34.0`, and `effect:^3.21.0`. Treat
  this as prior art only until a v9-compatible adapter is proven.
- Current frontend shell: `apps/web/src/router.tsx` wires `ConvexQueryClient`,
  TanStack `QueryClient`, TanStack Router, and `setupRouterSsrQueryIntegration`;
  `apps/web/package.json` pins `@tanstack/react-query` `5.101.0`,
  `@tanstack/react-router` `1.170.16`, `@tanstack/react-start` `1.168.26`,
  `@confect/react` `9.1.5`, and `effect` `3.21.4`.
- Effect Atom package metadata checked on 2026-07-03: `@effect-atom/atom-react`
  latest `0.5.0` depends on `@effect-atom/atom:^0.5.0` and peers `effect:^3.19`,
  React `>=18 <20`, and `scheduler:*`; `@effect-atom/atom` latest `0.5.3` peers
  `@effect/experimental:^0.58.0`, `@effect/platform:^0.94.2`,
  `@effect/rpc:^0.73.0`, and `effect:^3.19.15`.
- Existing observability seam: `packages/observability/src/index.ts` already
  provides redacted PostHog capture and non-fatal capture failures; the plan
  adds Confect middleware that logs typed/untyped failures to this seam without
  swallowing the original Effect cause.
- Current generator drift: `tooling/generators/src/index.ts:1016-1125` emits
  draft capability files under `generated/capabilities/<name>/`;
  `tooling/generators/src/index.ts:1350-1435` emits promoted capabilities under
  nested `packages/convex/confect/capabilities/<name>/`;
  `docs/template/how-to-add-agent.md` references a missing
  `template:add-agent-seat` command.
- Current ambient time sites:
  `packages/convex/confect/access/provisioning.impl.ts`,
  `packages/convex/confect/access/invitations.impl.ts`,
  `packages/convex/confect/access/members.impl.ts`,
  `packages/convex/confect/brain/pages.impl.ts`,
  `packages/convex/confect/demo/showcase.impl.ts`, and
  `packages/convex/confect/shared/determinism.ts`.
- Maestro PostHog component pattern:
  `/Users/headless/maestro/packages/convex/convex/adapters/posthog.ts:1-13`
  instantiates `new PostHog(components.posthog)` and
  `/Users/headless/maestro/packages/convex/convex/adapters/posthog.ts:232-240`
  quarantines capture errors.
- Maestro editor source example:
  `/Users/headless/maestro/packages/convex/convex/adapters/prosemirror.ts`,
  `/Users/headless/maestro/packages/convex/convex/prosemirrorSync.ts`,
  `/Users/headless/maestro/packages/convex/convex/convex.config.ts`, and
  `/Users/headless/maestro/apps/web/src/components/studio/StudioEditor.tsx`.
- Multi-model review artifacts folded into this plan on 2026-07-03:
  - `/Users/headless/fabro-workflows/plans/effectified-maestro-template-plan-review/01-drafts/or-codex.plan.md`
  - `/Users/headless/fabro-workflows/plans/effectified-maestro-template-plan-review/01-drafts/or-sonnet.plan.md`
  - `/Users/headless/fabro-workflows/plans/effectified-maestro-template-plan-review/06-explicit-review/reviews/or-codex.review.md`
  - `/Users/headless/fabro-workflows/plans/effectified-maestro-template-plan-review/06-explicit-review/reviews/or-deepseek-flash.review.md`
  - `/Users/headless/fabro-workflows/plans/effectified-maestro-template-plan-review/06-explicit-review/review-synthesis.md`

## Reviewer Context Packet

This plan is intended for agents who have not read the original gist, Discord
discussion, or prior chat. The gist must remain untouched; this file is the
review artifact. Reviewers should treat `/Users/headless/maestro-template` as
the implementation repo and `/Users/headless/maestro` as prior art only.

### What Reviewers Should Evaluate

- Does each task preserve Confect v9's filesystem-driven, lazy, per-group
  cold-start model?
- Does each reusable primitive satisfy the `effectified-full` contract pack:
  pure domain boundary, Effect schemas, Confect contract, workflow-step ref when
  dispatchable, services, surface manifest, frontend state, docs, tests, and
  gates?
- Does the workflow plan preserve the existing template graph/evidence/Trust
  Receipt spine while importing only generic Maestro workflow lessons?
- Does the frontend plan choose Convex/Confect live hooks by default, keep
  TanStack Router/Start as the shell, and restrict Effect Atom to opt-in complex
  local orchestration?
- Does the editor plan vendor BlockNote/Tiptap/ProseMirror sync as generic
  template packages without product-specific Maestro behavior?
- Are all generated-file edits followed by codegen and drift checks?
- Are preflight API proof snippets present before agents implement snippets that
  depend on Confect v9, Effect `Service`/`Config`, `@convex-dev/workflow`,
  PostHog, or ProseMirror sync APIs?
- Does the headless executor invoke real generated refs before any HTTP/CLI/MCP
  surface is considered production-ready, rather than returning canned
  `{ accepted: true }` payloads?
- Are editor sync `checkRead` and `checkWrite` tenant-safe before the editor
  substrate is advertised as production-ready?

### External Documentation Index

| Area                                     | Links                                                                                                                                                                                                                                                                                                                                                                                          | Why it matters                                                                                                                                                                 |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Confect v9 architecture                  | https://github.com/rjdellecese/confect/releases/tag/%40confect/core%409.0.0                                                                                                                                                                                                                                                                                                                    | Source of the v9 migration rules: colocated groups, lazy tables/specs, generated schema, removed aggregate roots, Node groups, and cold-start behavior.                        |
| Confect concepts                         | https://confect.dev/getting-started/introduction, https://confect.dev/concepts/spec-impl-model, https://confect.dev/concepts/schema-restrictions, https://confect.dev/concepts/services                                                                                                                                                                                                        | Defines the spec/impl split, lazy schema thunks, Confect-compatible Effect schemas, generated services, and client-safe contracts.                                             |
| Effect services and errors               | https://effect.website/docs/requirements-management/services/, https://effect.website/docs/requirements-management/layers/, https://effect.website/docs/configuration/, https://effect.website/docs/error-management/expected-errors/                                                                                                                                                          | Grounds the plan's service/layer/config/typed-error design.                                                                                                                    |
| Effect Schema and OpenAPI projections    | https://effect.website/docs/schema/introduction/, https://effect.website/docs/schema/annotations/, https://effect.website/docs/schema/json-schema/                                                                                                                                                                                                                                             | Used for persisted rows, args, returns, public errors, generated JSON Schema, OpenAPI, and Scalar docs.                                                                        |
| Convex workflow runtime                  | https://www.convex.dev/components/workflow, https://github.com/get-convex/workflow                                                                                                                                                                                                                                                                                                             | Justifies keeping `@convex-dev/workflow` as durable replay runtime with sleep, await-event, cancel/restart, and reactive status.                                               |
| Convex realtime and TanStack integration | https://www.convex.dev/sync, https://docs.convex.dev/client/tanstack/tanstack-start/, https://docs.convex.dev/client/tanstack/tanstack-query/, https://tanstack.com/query/latest/docs/framework                                                                                                                                                                                                | Explains why Convex/Confect hooks are the default server-state path and TanStack Query remains a shell/prefetch/legacy integration rather than the generic Effect state model. |
| Effect Atom frontend state               | https://github.com/tim-smart/effect-atom, https://mintlify.wiki/tim-smart/effect-atom/introduction, https://www.npmjs.com/package/%40effect-atom/atom-react                                                                                                                                                                                                                                    | Context for the opt-in frontend Effect state path and its experimental/runtime-aware tradeoffs.                                                                                |
| Frontend Effect/RPC discussion prior art | https://www.youtube.com/watch?v=NGBijq6cdfc&t=212s, https://github.com/ethanniser/effect-rpc-rx-example                                                                                                                                                                                                                                                                                        | Background for the TanStack Query vs Effect/Effect Atom discussion. Treat as design context, not as normative docs.                                                            |
| `confect-workflow` prior art             | https://npmx.dev/package/confect-workflow, https://www.npmjs.com/package/confect-workflow                                                                                                                                                                                                                                                                                                      | Shows an existing Confect/workflow integration idea, but it is alpha and peers Confect v3, so this plan studies it without depending on it.                                    |
| Editor substrate                         | https://www.blocknotejs.org/docs, https://www.blocknotejs.org/docs/foundations/document-structure, https://tiptap.dev/docs/editor/core-concepts/schema, https://tiptap.dev/docs/editor/core-concepts/prosemirror, https://www.convex.dev/components/prosemirror-sync, https://github.com/get-convex/prosemirror-sync, https://stack.convex.dev/add-a-collaborative-document-editor-to-your-app | Grounds the BlockNote/Tiptap/ProseMirror sync tasks and schema-drift guard.                                                                                                    |
| PostHog and Convex observability         | https://posthog.com/docs/libraries/convex, https://github.com/PostHog/posthog-js/tree/main/packages/convex, https://docs.convex.dev/production/integrations/log-streams/                                                                                                                                                                                                                       | Grounds the PostHog component mount and failure-capture middleware.                                                                                                            |

### Local Template Context Index

| File                                                                                                                                                                                                                                          | Review purpose                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `AGENTS.md`                                                                                                                                                                                                                                   | Repo rules for Confect/Effect work, generated files, tests, RTK commands, and agent behavior.                                |
| `agent-patterns/effect-confect.md`, `agent-patterns/confect-spec-impl.md`, `agent-patterns/confect-testing.md`, `agent-patterns/effect-schema-errors.md`, `agent-patterns/effect-services-layers.md`, `agent-patterns/confect-http-scalar.md` | Local implementation patterns for Confect v9 specs/impls, tests, typed errors, services/layers, and HTTP/Scalar projection.  |
| `docs/template/confect-effect-guide.md`                                                                                                                                                                                                       | Current compatibility matrix and Confect/Effect authoring rules that this plan upgrades.                                     |
| `docs/template/effect-confect-working-plan.md`                                                                                                                                                                                                | Earlier rationale for using vendored/local Effect and Confect source/tests over snippets.                                    |
| `docs/template/frontend-architecture.md`                                                                                                                                                                                                      | Current frontend layering rules and Confect state adapter expectations.                                                      |
| `docs/design-intake/2026-07-01-template-frontend-stack-source.md`                                                                                                                                                                             | Prior frontend decision source: TanStack Start direction, React Flow only for workflows, and what to port from Maestro.      |
| `docs/template/workflow-authoring-guide.md`                                                                                                                                                                                                   | Current workflow graph/run authoring surface that this plan expands.                                                         |
| `docs/template/generator-output-contract.md`                                                                                                                                                                                                  | Current generator contract that this plan turns into effectified-full primitive output.                                      |
| `docs/template/integrations.md`, `docs/template/env-manifest.md`                                                                                                                                                                              | Provider posture, PostHog/env boundaries, and fake/test/live runtime expectations.                                           |
| `docs/template/agent-worker-playbook.md`                                                                                                                                                                                                      | Agent-facing summary of layer law, Effect/Confect expectations, and generator usage.                                         |
| `docs/template/quickstart.md`, `docs/template/demo-seed-contract.md`, `docs/template/template-maturity-model.md`                                                                                                                              | Product-shell expectations: seeded Brain/workflow demo, first useful workflow, maturity gates, and live-reference-app proof. |
| `docs/template/security-threat-model.md`, `docs/template/operations-runbook.md`, `docs/template/client-intake-wizard.md`                                                                                                                      | Security/ops/client-intake context for tenancy, provider posture, workflow limits, and production handoff.                   |
| `docs/rule-coverage.md`, `tooling/quality/contract-review-rubric.md`                                                                                                                                                                          | Current rule/gate coverage and review rubric.                                                                                |
| `packages/convex/confect/workflows/{graph,runGraph,evidence,trustReceipt}.ts` and `packages/convex/test/{workflow-graph,workflow-run,trust-receipt}.test.ts`                                                                                  | Existing template workflow spine that must be preserved, not replaced.                                                       |
| `packages/workflow-ui/src/index.tsx`, `apps/web/src/adapters/confect-state.ts`, `apps/web/src/router.tsx`                                                                                                                                     | Current frontend primitives and TanStack/Confect shell that the plan extends.                                                |
| `tooling/eslint-plugin-template/rules/workflow-handler-determinism.mjs`, `workflow-steps-are-capabilities.mjs`, `workflow-policy-snapshot.mjs`, `tooling/quality/check-workflow-graph-boundary.mts`                                           | Existing workflow safety gates.                                                                                              |
| `tooling/generators/src/index.ts`, `tooling/generators/src/index.test.ts`                                                                                                                                                                     | Current generator drift source.                                                                                              |

### Maestro Prior Art Index

| Prior art                                                                                                                                                                                                                                        | What to preserve                                                                                                                       | What not to copy                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `/Users/headless/maestro/packages/convex/convex/workflows/generatePost.ts`                                                                                                                                                                       | Durable staged workflow shape, capability-only steps, retry policy, parent-result projection, observability best-effort behavior.      | Product-specific post generation, client voice, LinkedIn, and content policy names. |
| `/Users/headless/maestro/packages/convex/convex/adapters/workflowGraphRunner.ts`                                                                                                                                                                 | Generic graph interpreter ideas: capability registry lookup, topological walk, delay, conditions, stage observation, JSON-safe output. | Any capability refs that are product-specific or not generated by the template.     |
| `/Users/headless/maestro/packages/convex/convex/domain/workflowGraph*.ts`, `checks/workflow*.ts`, `schema/workflow*.ts`                                                                                                                          | Workflow graph validation, condition syntax, stage/run/link schema patterns, and domain projection boundaries.                         | Maestro-only workflow template taxonomy unless generalized.                         |
| `/Users/headless/maestro/packages/convex/convex/capabilities/workflow/*` and `repos/workflow/*`                                                                                                                                                  | Runs, stages, statuses, links, manual retry, timeout, and duration read/write patterns.                                                | Admin/operator product UI assumptions.                                              |
| `/Users/headless/maestro/docs/superpowers/specs/2026-06-21-workflow-definitions-and-react-flow.md`, `2026-06-27-living-knowledge-workflows-v1.md`, `2026-06-19-workflow-observability.md`, `2026-06-27-workflow-builder-editor-ultimate-spec.md` | Workflow graph as source of truth, React Flow as projection, stage overlays, authorable capability catalog, bounded node types.        | Ambitious node kinds unless runtime semantics are defined and tested.               |
| `/Users/headless/maestro/apps/web/src/features/workflows/workflow-canvas-state.ts`, `workflow-canvas-adapter.ts`, `components/node-types/*`, `components/edge-types/*`                                                                           | Pure view-model plus adapter split, status overlay, viewer/editor separation, typed node components.                                   | Styling, product copy, and Maestro-specific route composition.                      |
| `/Users/headless/maestro/packages/convex/convex/adapters/prosemirror.ts`, `prosemirrorSync.ts`, `/Users/headless/maestro/apps/web/src/components/studio/StudioEditor.tsx`                                                                        | BlockNote/Tiptap/ProseMirror schema seam, component mount shape, web wrapper shape.                                                    | Studio/product document behavior.                                                   |
| `/Users/headless/maestro/packages/convex/convex/adapters/posthog.ts`, `docs/launch/posthog-production-readiness-runbook.md`                                                                                                                      | Convex PostHog component initialization, redaction, capture quarantine, event taxonomy discipline.                                     | Product-specific event names unless mapped into template-safe events.               |

### Version Checkpoint For Reviewers

These checks were run on 2026-07-03. The implementation must re-run them before
editing package manifests because patch releases are moving:

| Package family                 | Repo/plan pin                   | Latest observed                                                                                                                   | Reviewer decision                                                                                                                                                                                   |
| ------------------------------ | ------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@confect/*`                   | repo pins `9.1.5`               | npm reported `9.1.5` for `@confect/core`, `@confect/server`, `@confect/react`, `@confect/test`, `@confect/cli`, and `@confect/js` | Accepted the latest observed v9 patch in Task 2A. Do not mix Confect patch versions.                                                                                                                |
| `@convex-dev/workflow`         | `^0.4.4` / plan runtime `0.4.4` | npm reported `0.4.4`                                                                                                              | Keep unless a newer release appears.                                                                                                                                                                |
| `@effect-atom/atom-react`      | opt-in, not default             | npm reported `0.5.0`                                                                                                              | Only add behind an adapter and bundle gate.                                                                                                                                                         |
| `confect-workflow`             | not a dependency                | npm reported `0.0.0-alpha.3` with Confect v3 peers                                                                                | Prior art only unless a v9-compatible release exists and is proven.                                                                                                                                 |
| `@convex-dev/prosemirror-sync` | plan originally names `0.2.4`   | npm reported `0.2.5`                                                                                                              | Recheck and exact-pin deliberately in editor task.                                                                                                                                                  |
| `@posthog/convex`              | Maestro example used `2.0.28`   | npm reported `2.0.32`                                                                                                             | Recheck and exact-pin deliberately in observability task.                                                                                                                                           |
| BlockNote                      | plan originally named `0.51.2`  | npm reported `@blocknote/core` and `@blocknote/react` `0.51.4` for the wrapper used here                                          | Recheck the BlockNote packages actually imported by this template and pin one compatible family. Do not add `@blocknote/mantine` unless a Mantine wrapper is introduced with its Mantine peer deps. |
| Tiptap                         | plan originally named `3.27.0`  | npm reported `@tiptap/core` and `@tiptap/pm` `3.27.1`                                                                             | Recheck and keep Tiptap packages on one compatible patch.                                                                                                                                           |

### Topic-To-Task Map

| Topic                       | Main tasks                         | Review focus                                                                                                                                                      |
| --------------------------- | ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Confect v9 baseline         | Task 2A, Tasks 9-10, Tasks 12-16   | No aggregate roots, lazy schemas, generated `databaseSchema`, submodule Effect imports, typed errors in specs and impls.                                          |
| Tenancy and typed errors    | Tasks 4-10, Task 13                | Workspace access is server-derived, public errors are declared and redacted, tests assert Effect error channel behavior.                                          |
| Effectified-full primitives | Task 12A, Tasks 12-19, Tasks 20-24 | Primitive metadata, builders, generators, manifest, API/CLI/MCP/OpenAPI projections all share one source.                                                         |
| Workflows                   | Tasks 22A-23                       | Preserve graph/evidence/Trust Receipt, use `@convex-dev/workflow` only for replay handlers, Confect wraps start/status/control, stage rows and links are durable. |
| Frontend state              | Tasks 26-26C                       | Existing `confect-state.ts` stays canonical, TanStack Query is not used as generic Effect runner, Effect Atom is adapter-gated.                                   |
| Observability               | Task 25A                           | PostHog capture never swallows original Effect causes; redaction and event shape live in `packages/observability`.                                                |
| Editor substrate            | Tasks 27-30                        | Generic editor packages, exact pins, backend ProseMirror seam, no product-specific Maestro Studio code.                                                           |
| Quality gates               | Tasks 2A, 20-21, 26B, 31-32        | Static gates prove architecture claims; broad verify remains semaphore-wrapped.                                                                                   |

### Reviewer Checklist

- Every new Confect table uses `Table.make(() => ...)`; every spec uses `args`,
  `returns`, and `error` schema thunks.
- Every Confect impl imports generated `databaseSchema`, default-imports its
  sibling spec, and ends with `GroupImpl.finalize`.
- No task hand-edits generated files without running the matching codegen
  command.
- Workflow replay handlers remain plain `convex/workflows/*.ts` files and do not
  import app services directly.
- Workflow graph nodes are data. React Flow nodes/edges are projections and are
  never persisted as source of truth.
- Public/API/CLI/MCP surfaces are deny-by-default and derive from manifest
  metadata.
- Frontend components render canonical adapter states, not raw `QueryResult`,
  TanStack Query, or `Effect.Exit`.
- Effect Atom imports are absent unless the adapter package and bundle gate land
  first.
- Editor packages are exact-pinned and generic; schema drift fails loudly.
- Observability captures are best-effort and preserve original typed failures or
  defects.

## Stack Selection Decisions

- **Backend contracts:** Confect v9 is the default authoring layer for
  public/internal functions, typed errors, schema decoding, generated refs, and
  `@confect/test`. Do not reintroduce root aggregate `confect/spec.ts` or
  `confect/impl.ts`.
- **Durable workflow runtime:** `@convex-dev/workflow` stays the runtime
  substrate for replay, sleep, event wait, cancel, restart, component status,
  and workpool-backed step execution. Effect and Confect wrap the
  kickoff/status/ledger surfaces and step capabilities; they do not replace the
  workflow component's deterministic replay model.
- **Workflow domain model:** The template keeps the existing durable
  graph/evidence/Trust Receipt model and imports Maestro's mature missing
  pieces: topological graph execution, capability-ref lookup, status projection,
  workflow ownership rows, parent-child links, timeout/manual retry surfaces,
  and stage/event ledgers.
- **`confect-workflow` stance:** Study its split between `workflowSpec`,
  `defineWorkflow`, `WorkflowContext`, and manager services, but do not add it
  as a dependency in this plan. It is alpha, pre-Confect-v9, and its README
  examples use old aggregate APIs. If its ideas are useful, implement the small
  v9-compatible adapter locally under
  `packages/convex/confect/workflows/_kit/*`.
- **Frontend shell:** The current TanStack Router/Start shell remains because
  the repo already uses it for routing/SSR, but the plan does not treat TanStack
  Start as the default state model. The frontend state decision is separate and
  must be justified by workflow, Convex reactivity, bundle size, and typed-error
  needs.
- **Frontend server state:** Convex/Confect live hooks are the default path for
  Convex-backed data because they fit Convex reactivity. TanStack Query stays
  available for the existing `@convex-dev/react-query` router integration, route
  prefetching, and legacy surfaces, but generic `Effect.runPromise` inside
  `useQuery` is not the default pattern.
- **Frontend Effect state:** Effect Atom is an opt-in experiment for complex
  client-side orchestration, local-first or worker-backed flows, streams,
  optimistic state, and Effect-native runtime/scope handling. It must live
  behind an adapter package and bundle gate before it becomes template default.
- **Simple frontend effects:** `Effect.runPromise` is allowed only at explicit
  boundary adapters for isolated actions. Each use must wire cancellation/abort,
  map typed errors into UI state, and avoid storing `Either` failures as
  successful query cache values.

## Full Contract Primitive Doctrine

Every reusable template primitive must ship as an `effectified-full` contract
pack so other apps can copy the primitive without reverse-engineering hidden
Maestro assumptions.

Required pieces for each primitive:

- **Pure domain module:** deterministic data shapes, planners, reducers, and
  validation helpers with no Convex ctx, React, random, ambient time, provider
  SDK, or generated-ref imports.
- **Effect Schema contract:** arg, return, persisted-row, and public error
  schemas using `effect/Schema` submodule imports and Confect-compatible schema
  restrictions.
- **Confect v9 API contract:** colocated `*.spec.ts`/`*.impl.ts` pair, generated
  table wrappers, lazy schema thunks, generated `databaseSchema`, typed public
  errors, and `GroupImpl.finalize`.
- **Workflow dispatch contract:** dispatchable primitives expose an internal
  workflow-step ref, capability registry metadata, retry policy, idempotency
  semantics, and stage/evidence/Trust Receipt hooks.
- **Effect service boundary:** config, clock, auth/principal, provider clients,
  observability, and storage are services or Confect-provided services rather
  than ad hoc imports.
- **Surface manifest:** web/API/CLI/MCP/OpenAPI/Scalar metadata is derived from
  the Confect contract plus explicit deny-by-default surface policy.
- **Frontend view contract:** UI packages export pure view-model state algebras
  and adapters for Confect/Convex results; React components consume those states
  instead of importing backend Effect programs directly.
- **Tests and gates:** each primitive lands with domain tests, Confect contract
  tests, generator parity tests when generated, surface-policy tests, and
  focused frontend view-model tests when UI-visible.
- **Docs:** each primitive includes a generated or handwritten authoring note
  that states its ownership boundary, runtime boundary, surfaces, typed errors,
  workflow-step eligibility, and copy/paste checklist.

Not every file in a primitive imports Effect. The contract layer uses Effect and
Confect heavily; pure domain modules and React renderers stay plain when that is
the smaller, more reusable boundary.

## Operating Rules

- All shell commands in this plan use `rtk`. If a command is chained, each
  segment is prefixed separately.
- Broad local gates run through the host semaphore:
  `rtk host-test-slot --class full pnpm verify` or
  `rtk host-test-slot --class focused <focused command>`.
- Root `pnpm typecheck`, `pnpm test`, `pnpm build`, `pnpm verify`, and any check
  that fans out through Turbo, broad Vitest, or broad generated-file validation
  must also run through `host-test-slot`. A command may run without
  `host-test-slot` only when it is narrowly scoped to one package/file and does
  not spawn a broad suite.
- `host-test-slot` is a shared local semaphore wrapper on this host. It
  serializes broad test work and limits nested workers. If an off-host
  implementation environment does not provide it, run the same underlying `pnpm`
  command directly only after recording the difference in the phase note.
- Do not include `check:generators` in Fabro preflight/readiness checks. It may
  require a live Convex deployment connection; only run it at the explicit task
  steps below, and record an environmental blocker instead of retrying if Convex
  codegen cannot connect.
- Never edit generated files by hand: `packages/convex/confect/_generated/*`,
  `packages/convex/convex/_generated/*`, `packages/convex/convex/schema.ts`,
  `apps/web/src/routeTree.gen.ts`, and
  `packages/template-core/src/generated/confectManifest.ts`.
- Do not edit `repos/effect` or `repos/confect`; they are citation/reference
  material only.
- Run Confect codegen after any `confect/**.spec.ts`, `confect/**.impl.ts`,
  `confect/tables/*`, Confect component registration,
  `packages/convex/convex/convex.config.ts`, or Confect manifest-generation
  change.
- After any generated-affecting task, run the matching generator, inspect the
  generated diff, and use `rtk git diff --exit-code <generated paths>` to prove
  there is no uncommitted drift after regeneration.
- Before every file-modifying step, read the current file. If the current file
  differs from the expected starting point, adapt the implementation to the
  actual code instead of appending duplicate APIs.
- Plan-review/model-pass runs must not execute branch or commit commands. The
  branch/commit steps below are for implementation agents only.
- Each task ends at a commit boundary. If a task is split into multiple PRs,
  preserve the task order and keep each PR in the same phase.

## File Responsibility Map

- `docs/template/effectification-status.md`: durable migration ledger and phase
  status.
- `docs/template/confect-effect-guide.md`: compatibility matrix, Confect schema
  rules, typed-error examples, `@confect/test` shape, manifest-generation
  invariants.
- `docs/template/primitive-contract.md`: `effectified-full` primitive contract
  doctrine and copy/paste checklist for other apps.
- `docs/template/generator-output-contract.md`: generator output contract after
  flat capability/workflow/agent slices land.
- `docs/rule-coverage.md`: enforcement tier map, upgraded when pin-only gates
  become semantic.
- `packages/template-core/src/primitiveContract.ts`: portable metadata shape for
  full-contract primitives, generator output, docs, and later manifest parity
  checks.
- `packages/convex/test/support/confect.ts`: shared `@confect/test` layer and
  typed-error assertion helpers.
- `packages/convex/test/support/seedTenancy.ts`: deterministic test fixture
  inserts for users, orgs, workspaces, memberships, and API keys.
- `packages/convex/confect/capabilities/_kit/errors.ts`: public typed-error
  families and reusable schema unions.
- `packages/convex/confect/capabilities/_kit/principal.ts`: Principal algebra
  for user, API key, workflow, and system callers.
- `packages/convex/confect/capabilities/_kit/surfaces.ts`: deny-by-default
  surface policy metadata and schema.
- `packages/convex/confect/capabilities/_kit/workspaceAccess.ts`:
  generated-service-backed workspace access resolution.
- `packages/convex/confect/capabilities/_kit/capability.ts`: capability builder
  that rewrites spec error unions, attaches manifest metadata, and produces
  Confect specs/impl helpers.
- `packages/convex/confect/workflows/_kit/observedStage.ts`: Effect helpers that
  wrap workflow step execution with stage start/finish/failure records while
  preserving original workflow failures.
- `packages/convex/confect/workflows/_kit/ownership.ts`: Confect/Effect service
  for starting `@convex-dev/workflow` runs and inserting workspace-owned
  workflow run rows.
- `packages/convex/confect/workflows/_kit/status.ts`: typed projection of
  `@convex-dev/workflow` status plus local timeout/manual-retry state.
- `packages/convex/confect/workflows/_kit/graphRunner.ts`: Effectified port of
  Maestro's generic graph runner over the existing durable graph schema.
- `packages/convex/confect/tables/workflowRunLinks.ts`: parent-child workflow
  link table for batch/child workflows and graph fan-out.
- `packages/convex/confect/manifest/*`: contract manifest builder,
  JSON/OpenAPI/MCP projections, and kind-aware executor.
- `packages/template-core/src/generated/confectManifest.ts`: generated
  client-safe manifest artifact consumed by CLI/web/tooling.
- `tooling/confect-manifest/*`: manifest generator CLI and tests.
- `tooling/quality/check-confect-contracts.mts`: upgraded from descriptor pin to
  semantic Confect contract checks.
- `tooling/quality/check-confect-v9.mts`: Confect v9 invariant gate for package
  pins, colocated groups, lazy schema thunks, generated schema use, and
  submodule Effect imports.
- `tooling/quality/check-headless-surface-contract.mts`: upgraded to prove
  deny-by-default and generated projection parity.
- `tooling/generators/src/index.ts`: add/update capability, workflow, and agent
  generators.
- `packages/convex/confect/shared/config.ts`: Effect `Config` and service-backed
  template runtime configuration.
- `packages/convex/confect/shared/clock.ts`: Effect Clock helpers after the
  first real migration proves the pattern.
- `packages/convex/confect/observability/errorCapture.ts`: Effect middleware for
  Confect mutation/action/query failure capture that preserves the original
  error channel.
- `packages/convex/confect/observability/posthog.ts`: Convex/PostHog event
  capture adapter used by the middleware.
- `docs/template/frontend-effect-state.md`: explicit frontend stack policy for
  Confect hooks, Convex reactivity, TanStack Query/Start, Effect Atom, bundle
  budgets, and typed-error UI boundaries.
- `apps/web/src/adapters/effectBoundary.ts`: approved frontend boundary helpers
  for rare `Effect.runPromise` use.
- `tooling/quality/check-frontend-effect-boundary.mts`: static gate for client
  `Effect.runPromise` usage, client Effect barrel imports, and unapproved Effect
  Atom imports.
- `packages/workflow-ui/src/workflowCanvasState.ts`: pure workflow canvas
  view-model derived from Maestro prior art; no React, Convex, Effect runtime,
  or adapter imports.
- `packages/workflow-ui/src/index.tsx`: React Flow renderer that consumes the
  pure workflow canvas model.
- `apps/web/src/features/workflows/workflowCanvasAdapter.ts`: app-specific
  boundary that combines graph sources, Confect/Convex stage rows, and workflow
  canvas overlays.
- `packages/editor-core/*`: framework-agnostic editor schemas, document ids,
  snapshots, and JSON codecs.
- `packages/editor-react/*`: BlockNote React wrapper and web-facing sync
  adapter.
- `packages/convex/confect/editor/*`: backend editor sync seams, typed errors,
  Confect specs/impls, and plain Convex component functions.
- `tooling/effectified-api-proof/*`: tiny compile-only proof files for Confect
  v9, Effect config/services, workflow runtime API, PostHog, and editor sync
  imports. These are deleted or kept as tests only after their dependent phases
  pass.

## Execution Phases

0. Phase 0: preflight API proofs and review-amendment guardrails.
1. Phase A: docs, Confect v9 invariants, baseline, and executable Confect tests.
2. Phase B: tenancy, typed errors, and Clock-backed persisted paths.
3. Phase C: capability builder, manifest, real headless executor, and generated
   headless projections.
4. Phase D: generators and semantic quality gates.
5. Phase E: Effect services, frontend adapters, reusable workflow UI primitives,
   and runtime ergonomics.
6. Phase F: exact-pinned editor substrate.
7. Phase G: final docs, broad verification, and cleanup.

Execution note: Task 1 creates the implementation branch. Run Task 1 Steps 1-2
first, then Task 0, then resume Task 1 Step 3 and continue in numeric order.

## Subagent Execution Packet

Use `superpowers:subagent-driven-development` for implementation. The controller
must not send this whole file as one giant prompt. For each task, dispatch one
fresh implementer subagent with:

- the plan header, Operating Rules, File Responsibility Map entries that apply
  to the task, and the complete text of exactly one task;
- the current `rtk git status --short --branch` output;
- any directly preceding task commit SHA that created files imported by this
  task;
- a reminder to read current files before editing, use TDD where the task
  includes tests, run only the commands listed for that task, and end with the
  task commit unless blocked.

After each implementer reports `DONE` or `DONE_WITH_CONCERNS`, dispatch a fresh
spec reviewer with the same one-task context plus the implementation diff. The
spec reviewer answers only whether the diff satisfies the task text and whether
it added unrequested behavior. After spec approval, dispatch a fresh
code-quality reviewer with the implementation diff and focused test output. The
quality reviewer checks maintainability, generated-file discipline, host
semaphore use, and whether any test gap remains.

Do not run multiple implementation subagents in parallel. These tasks touch
shared package manifests, generated Confect files, and root scripts, so parallel
implementation would create merge churn and stale generated artifacts. Review
subagents may run only after the corresponding implementation task has
committed.

Task batching for controller planning only:

- Phase 0/A bootstrap: Tasks 1 Steps 1-2, Task 0, Task 1 Step 3, Tasks 2-3.
- Phase B contracts: Tasks 4-11.
- Phase C manifest/headless: Tasks 12-21.
- Phase D generators/workflows: Tasks 22-24, including Task 22A.
- Phase E runtime/frontend/observability: Tasks 25-26C, including Task 25A.
- Phase F editor: Tasks 27-31.
- Phase G verification/docs: Tasks 32-35.

When a reviewer finds an issue, return only that task's diff and reviewer notes
to the implementer for a fix commit or amend, then re-run the same review stage.
If a subagent reports `NEEDS_CONTEXT`, answer with a targeted file excerpt or
command output. If it reports `BLOCKED`, change exactly one variable before
retrying: provide missing context, upgrade model, split the task, or patch this
plan if the task is wrong.

## Task 0: Prove External API Shapes Before Implementation

**Files:**

- Create: `tooling/effectified-api-proof/package.json`
- Create: `tooling/effectified-api-proof/confect-v9-proof.ts`
- Create: `tooling/effectified-api-proof/effect-config-proof.ts`
- Create: `tooling/effectified-api-proof/workflow-proof.ts`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `docs/template/effectification-status.md` if Task 2 has already
  created it.

- [ ] **Step 1: Add a compile-only preflight package**

Create `tooling/effectified-api-proof/package.json`:

```json
{
  "name": "@maestro-template/effectified-api-proof",
  "private": true,
  "type": "module",
  "scripts": {
    "typecheck": "tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 --jsx react-jsx --skipLibCheck *.ts"
  },
  "dependencies": {
    "@confect/core": "9.1.5",
    "@confect/server": "9.1.5",
    "@confect/test": "9.1.5",
    "@convex-dev/workflow": "0.4.4",
    "convex": "1.42.1",
    "effect": "3.21.4"
  },
  "devDependencies": {
    "typescript": "^5.0.0"
  }
}
```

This package intentionally imports pinned APIs in isolation before the main plan
bakes snippets into the template. Task 2A accepted the `9.1.5` Confect patch, so
the proof package stays pinned with the real package manifests. The proof
package is part of the "all Confect packages share one exact patch" invariant,
even though it is only a compile-only workspace.

The proof script uses `--skipLibCheck` because Confect declaration barrels can
trip TypeScript `NodeNext` extension diagnostics (`TS2835`) inside
`node_modules` before the proof files are checked. Do not use `skipLibCheck` as
a general repo default; it is scoped to this compile-only external API proof
package.

- [ ] **Step 2: Prove Confect v9 spec/impl/test imports**

Create `tooling/effectified-api-proof/confect-v9-proof.ts`:

```ts
import { FunctionSpec, GroupSpec } from "@confect/core";
import { FunctionImpl, GroupImpl, Table } from "@confect/server";
import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Schema from "effect/Schema";

class ProofError extends Schema.TaggedError<ProofError>()("ProofError", {
  message: Schema.String,
}) {}

const proofSpec = GroupSpec.make().addFunction(
  FunctionSpec.publicQuery({
    name: "proof",
    args: () => Schema.Struct({ input: Schema.String }),
    returns: () => Schema.Struct({ output: Schema.String }),
    error: () => ProofError,
  }),
);

const proofTable = Table.make(() => Schema.Struct({ value: Schema.String }));

void proofSpec;
void proofTable;
void FunctionImpl;
void GroupImpl;
void Layer;
void Effect;
void TestConfect;
```

This is not a runnable Confect group. It proves import paths and schema-thunk
syntax against the installed package before Tasks 2A-3 depend on it.

- [ ] **Step 3: Prove Effect Config and service style**

Create `tooling/effectified-api-proof/effect-config-proof.ts`:

```ts
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export type TemplateRuntimeConfigShape = {
  readonly runtimeMode: "fake" | "test" | "live";
  readonly publicBaseUrl: string;
};

export class TemplateRuntimeConfig extends Context.Tag("TemplateRuntimeConfig")<
  TemplateRuntimeConfig,
  TemplateRuntimeConfigShape
>() {}

const runtimeMode = Config.literal(
  "fake",
  "test",
  "live",
)("TEMPLATE_RUNTIME_MODE").pipe(Config.withDefault("fake" as const));

const publicBaseUrl = Config.string("TEMPLATE_PUBLIC_BASE_URL").pipe(
  Config.withDefault("http://localhost:5173"),
);

export const TemplateRuntimeConfigLive = Layer.effect(
  TemplateRuntimeConfig,
  Effect.gen(function* () {
    return {
      runtimeMode: yield* runtimeMode,
      publicBaseUrl: yield* publicBaseUrl,
    };
  }),
);

export const proof = Effect.gen(function* () {
  const config = yield* TemplateRuntimeConfig;
  return config.runtimeMode;
}).pipe(
  Effect.provide(TemplateRuntimeConfigLive),
  Effect.withConfigProvider(ConfigProvider.fromMap(new Map())),
);
```

- [ ] **Step 4: Prove workflow runtime imports before graph-runner tasks**

Create `tooling/effectified-api-proof/workflow-proof.ts`:

```ts
import {
  defineWorkflow,
  getStatus,
  start,
  type WorkflowComponent,
  type WorkflowCtx,
  type WorkflowId,
} from "@convex-dev/workflow";
import type { FunctionReference, GenericMutationCtx } from "convex/server";
import { v } from "convex/values";

declare const component: WorkflowComponent;
declare const mutationCtx: GenericMutationCtx<any>;
declare const workflowRef: FunctionReference<
  "mutation",
  "internal",
  { args: { readonly id: string } },
  WorkflowId
>;

export const proofWorkflow = defineWorkflow(component, {
  args: { id: v.string() },
  returns: v.object({ id: v.string() }),
}).handler(async (step: WorkflowCtx, args) => {
  await step.sleep(1, { name: "proofDelay" });
  await step.awaitEvent({ name: `proof.${args.id}.approved` });
  return { id: args.id };
});

void start(mutationCtx, workflowRef, { id: "proof" });
void getStatus(mutationCtx, component, "workflow_proof" as WorkflowId);
```

If this proof fails because the pinned package exposes a different signature,
update Task 22A and Task 23 with the real API before implementing workflow code.
The proof must exercise `defineWorkflow(...).handler`, `WorkflowCtx.sleep`,
`WorkflowCtx.awaitEvent`, `start`, and `getStatus`; import-only proofs are not
enough.

- [ ] **Step 5: Reserve editor and PostHog proofs for their versioned tasks**

Do not add editor or PostHog dependencies in Task 0. Task 25A adds the PostHog
proof file after `@posthog/convex` is exact-pinned. Task 27 adds the editor
proof file after BlockNote/Tiptap/ProseMirror sync packages are exact-pinned.
Those proof files must exercise the constructor/hook/sync/capture shapes their
implementation tasks rely on. The implementation tasks must still prove real
component registration through `rtk pnpm confect:codegen`.

- [ ] **Step 6: Wire the root preflight script**

In root `package.json`, add:

```json
"check:effectified-api-proof": "pnpm --dir tooling/effectified-api-proof typecheck"
```

Do not add this script to `verify` until the optional editor/PostHog proof files
are added by their dependency tasks. Before Task 25A and Task 27, this script
proves only Confect, Effect config, and workflow runtime imports; after those
dependency tasks land, enable the full proof in `verify`.

- [ ] **Step 7: Run the proof that is valid for the current dependency set**

Before editor and PostHog dependencies are installed, run:

```bash
rtk pnpm install
rtk pnpm --dir tooling/effectified-api-proof typecheck
```

If the package-manager script cannot pass per-file arguments, run:

```bash
rtk pnpm exec tsc --noEmit --module NodeNext --moduleResolution NodeNext --target ES2022 tooling/effectified-api-proof/confect-v9-proof.ts tooling/effectified-api-proof/effect-config-proof.ts tooling/effectified-api-proof/workflow-proof.ts
```

Expected: the Confect, Effect, and workflow proof files typecheck before
implementation begins. Editor/PostHog proofs remain pending until their packages
are exact-pinned. `pnpm-lock.yaml` may change because this task adds a workspace
package.

- [ ] **Step 8: Record review integration**

If `docs/template/effectification-status.md` exists, add:

```markdown
## Multi-Model Review Amendments

The 2026-07-03 plan review required a preflight API proof phase, real headless
execution before production surfaces, manifest metadata bound to Confect
contracts, explicit workflow graph semantics, tenant-safe editor sync, exact
component registration snippets, and stronger generated-file drift policy.
```

- [ ] **Step 9: Commit**

Run:

```bash
rtk git add package.json tooling/effectified-api-proof pnpm-lock.yaml && rtk git commit -m "chore: prove effectified API shapes"
```

If `docs/template/effectification-status.md` already existed and Step 8 edited
it, add that file before the same commit. If it does not exist yet, do not add
it in Task 0; Task 2 creates it.

## Task 1: Establish A Clean Work Branch And Baseline

**Files:**

- Modify only by normal Git metadata: no source edits in this task.

- [ ] **Step 1: Confirm current repo state**

Run:

```bash
rtk git status --short
rtk git branch --show-current
```

Expected: output shows the current branch and any pre-existing changes. If there
are unrelated pre-existing changes, record them in the task note and do not
revert them.

- [ ] **Step 2: Create the implementation branch**

Run:

```bash
rtk git switch -c codex/effectified-template-plan-execution
```

Expected:
`Switched to a new branch 'codex/effectified-template-plan-execution'`.

- [ ] **Step 3: Run baseline focused checks**

Run:

```bash
rtk pnpm --dir packages/convex test confect-contracts
rtk pnpm --dir tooling/quality test check-confect-contracts
rtk pnpm --dir tooling/generators test
```

Expected: each command exits `0`. If a baseline command is red before edits,
capture the failing test name and error text in
`docs/template/effectification-status.md` in Task 2.

- [ ] **Step 4: Commit only if Task 2 creates the status document**

No commit is required for branch creation alone.

## Task 2: Add The Effectification Migration Ledger

**Files:**

- Create: `docs/template/effectification-status.md`
- Modify: `docs/template/confect-effect-guide.md`
- Modify: `docs/rule-coverage.md`

- [ ] **Step 1: Create the status document**

Create `docs/template/effectification-status.md` with this content:

```markdown
# Effectification Status

This document tracks the migration from a partially Confect-shaped template to
an Effect/Confect-rooted template where schemas, typed errors, tenancy, headless
surfaces, generators, and optional editor sync are derived from the same
contract family.

## Current Verified Baseline

- Confect packages are pinned to `9.1.5`; Effect is pinned to `3.21.4`.
- Durable tables live under `packages/convex/confect/tables/*`.
- Confect specs and impls exist for access, Brain pages, capabilities, jobs,
  ops, agents, auth, and demo surfaces.
- Generated Confect refs, schema, Convex schema, and registered function files
  exist under `packages/convex/confect/_generated/*`.
- `check:confect-contracts` and `check:confect-compat` are currently pin-only or
  mostly pin-only gates; semantic coverage is added by this plan.

## Known Gaps Being Closed

- `brain/pages` declares only `WorkspaceNotFound` and does not enforce active
  workspace membership before reads or writes.
- Several database-backed impls call `Date.now()` directly instead of using
  Effect `Clock.currentTimeMillis`.
- Headless API/CLI/MCP projections still derive from the canned
  `templateRegistry`, not generated Confect contract metadata.
- Generator draft and promotion output disagree on layout and still emit some
  inline synthetic tagged structures instead of importing the public error
  family.
- `docs/template/how-to-add-agent.md` references `template:add-agent-seat`, but
  the root `package.json` does not expose that script yet.
- The optional BlockNote/Tiptap/ProseMirror substrate is not vendored into the
  template as exact-pinned generic packages.
- Manifest generation must become contract-bound; manual manifest arrays are a
  temporary bootstrap only and must be cross-checked against generated refs.
- Runtime headless execution must call real generated refs before any API, CLI,
  or MCP surface is treated as production-ready.
- Workflow graph execution semantics must be defined before porting Maestro
  graph-runner ideas: node inputs, context, joins, conditions, delays,
  approvals, outputs, retries, and JSON-safe result projection.
- Editor sync auth must enforce workspace read/write access in `checkRead` and
  `checkWrite`; open placeholders are not production-safe.

## Generated Artifact Ownership

Never edit these files by hand:

- `packages/convex/confect/_generated/*` — generated by
  `rtk pnpm confect:codegen`.
- `packages/convex/convex/_generated/*` — generated by
  `rtk pnpm confect:codegen` and Convex codegen.
- `packages/convex/convex/schema.ts` — generated schema re-export; regenerated
  by Confect/Convex codegen.
- `packages/template-core/src/generated/confectManifest.ts` — generated by
  `rtk pnpm confect:manifest`.
- `apps/web/src/routeTree.gen.ts` — generated by TanStack Router tooling.

Each implementation task that changes a generator input must run the generator,
inspect the generated diff, and prove no stale generated output remains.

## Phase Status

| Phase | Scope                                                             | Status  |
| ----- | ----------------------------------------------------------------- | ------- |
| 0     | Preflight API proofs and review-amendment guardrails              | planned |
| A     | Docs, baseline, executable Confect tests                          | planned |
| B     | Tenancy, typed errors, and Clock-backed persisted paths           | planned |
| C     | Capability builder, manifest, executor, and generated projections | planned |
| D     | Generators and semantic gates                                     | planned |
| E     | Effect services, frontend adapters, and runtime ergonomics        | planned |
| F     | Exact-pinned editor substrate                                     | planned |
| G     | Final docs, broad verification, and cleanup                       | planned |

## Verification Log

Add one row per completed phase.

| Date | Phase | Command | Result |
| ---- | ----- | ------- | ------ |
```

- [ ] **Step 2: Extend `docs/template/confect-effect-guide.md` with a
      contract-manifest section**

Append this section:

```markdown
## Generated Contract Manifest

The generated Confect spec tree is the source of truth for API, CLI, MCP,
OpenAPI, Scalar, workflow, and web-facing operation metadata. Headless metadata
must be derived from Confect spec schemas plus explicit surface policy metadata;
it must not be duplicated in `packages/template-core/src/index.ts`.

Rules:

- Every public headless operation declares a typed public error schema.
- Every headless operation declares allowed surfaces explicitly.
- Surface exposure defaults to an empty set.
- Writes exposed over API, CLI, or MCP require an idempotency key argument.
- Tenant identity is server-derived through a Principal and workspace access
  resolver, never trusted from caller-supplied workspace slug alone.
- OpenAPI schemas are generated from Effect schemas with `effect/JSONSchema`
  after Confect schema restrictions are satisfied.
- Public error envelopes encode only the declared public `_tag` and redacted
  fields.
```

- [ ] **Step 3: Update `docs/rule-coverage.md`**

In the "Layer law and contracts" table, replace the
`Use Confect/Effect contracts` row with:

```markdown
| Use Confect/Effect contracts | mechanical: `check:convex` codegen drift diff,
`@confect/test` contract tests, generated-manifest parity tests, semantic
`check:confect-contracts`; pin-only remains only for static docs and
package-matrix guards |
```

- [ ] **Step 4: Run doc checks**

Run:

```bash
rtk host-test-slot --class focused pnpm check:docs-freshness
rtk host-test-slot --class focused pnpm check:confect-contracts
```

Expected: both commands exit `0`. `check:confect-contracts` may still report
pin-only semantics at this phase; the gate is upgraded later.

- [ ] **Step 5: Commit**

Run:

```bash
rtk git add docs/template/effectification-status.md docs/template/confect-effect-guide.md docs/rule-coverage.md && rtk git commit -m "docs: track effectification migration"
```

## Task 2A: Lock Confect V9 As A Mechanical Baseline

**Files:**

- Create: `tooling/quality/check-confect-v9.mts`
- Create: `tooling/quality/check-confect-v9.test.mts`
- Modify: `package.json`
- Modify: `packages/convex/package.json`
- Modify: `apps/web/package.json`
- Modify: `apps/cli/package.json`
- Modify: `tooling/effectified-api-proof/package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `tooling/quality/src/check-definitions.mts`
- Modify: `docs/template/confect-effect-guide.md`
- Modify: `docs/template/effectification-status.md`
- Modify: `docs/rule-coverage.md`

- [ ] **Step 1: Add the v9 baseline section to the Confect guide**

Run the package checkpoint:

```bash
rtk npm view @confect/core version
rtk npm view @confect/server version
rtk npm view @confect/react version
rtk npm view @confect/test version
rtk npm view @confect/cli version
rtk npm view @confect/js version
```

Expected: each command prints the same v9 patch, or the implementation records
why the repo remains on the prior patch. If the current patch is accepted,
update every `@confect/*` package together before running codegen, including
`tooling/effectified-api-proof/package.json`; do not mix Confect patch versions.
The 2026-07-03 follow-up checkpoint reported `9.1.5` for all `@confect/*`
packages, and Task 2A accepted that bump for the repo and proof package.

Append this section to `docs/template/confect-effect-guide.md`:

```markdown
## Confect V9 Baseline

This template treats Confect v9 as the required authoring model, not as an
optional upgrade. The v9 release rearchitected generated Convex modules so a
function imports only its own group registry at cold start instead of a
project-wide aggregate. The template must preserve that benefit as it grows.

Required invariants:

- All `@confect/*` packages remain on the same v9-compatible release line.
- API groups are filesystem-driven colocated `*.spec.ts` and `*.impl.ts` pairs.
- `GroupSpec.make()` and `GroupSpec.makeNode()` do not take a group-name
  argument; the file path names the group.
- Every table under `packages/convex/confect/tables/*` default-exports
  `Table.make(() => <Confect-compatible Effect schema>)`; the filename is the
  table name. The schema may be an imported constant as long as it is built
  lazily inside the callback.
- Specs import generated table wrappers from `confect/_generated/tables/*` for
  `Doc`, `Fields`, and `tableName`.
- Specs wrap `args`, `returns`, and `error` schemas in `() =>` thunks.
- Impls import `databaseSchema` from `confect/_generated/schema`, pass it to
  `FunctionImpl.make` and `GroupImpl.make`, default-import the sibling spec, and
  end with `GroupImpl.finalize`.
- Root aggregate `confect/spec.ts`, `confect/impl.ts`, `confect/nodeSpec.ts`,
  and `confect/nodeImpl.ts` must not exist.
- Confect source imports Effect submodules such as `effect/Effect`,
  `effect/Schema`, `effect/Layer`, `effect/Clock`, and `effect/Either`; it does
  not import from the `effect` barrel inside `packages/convex/confect`.
- `@confect/test` uses generated `confect/_generated/schema` and generated
  `confect/_generated/convexSchema`.

The compatibility gate `pnpm check:confect-v9` enforces these invariants.
```

- [ ] **Step 2: Create the v9 invariant gate**

Create `tooling/quality/check-confect-v9.mts`:

```ts
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { isDirectRun } from "./src/direct-run.mts";

export type V9Finding = {
  readonly file: string;
  readonly message: string;
};

const repoRoot = process.cwd();

const readJson = (path: string) =>
  JSON.parse(readFileSync(join(repoRoot, path), "utf8")) as {
    readonly dependencies?: Record<string, string>;
    readonly devDependencies?: Record<string, string>;
    readonly scripts?: Record<string, string>;
  };

const walk = (dir: string): readonly string[] => {
  if (!existsSync(join(repoRoot, dir))) return [];
  const out: string[] = [];
  for (const entry of readdirSync(join(repoRoot, dir))) {
    const path = join(dir, entry);
    const stat = statSync(join(repoRoot, path));
    if (stat.isDirectory()) out.push(...walk(path));
    if (stat.isFile()) out.push(path);
  }
  return out;
};

export const checkConfectPackagePins = (): readonly V9Finding[] => {
  const findings: V9Finding[] = [];
  const observed = new Map<string, string>();
  const packageFiles = [
    "packages/convex/package.json",
    "apps/web/package.json",
    "apps/cli/package.json",
    "tooling/effectified-api-proof/package.json",
  ];
  for (const file of packageFiles) {
    const pkg = readJson(file);
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    for (const [name, version] of Object.entries(deps)) {
      if (!name.startsWith("@confect/")) continue;
      if (!version.startsWith("9.")) {
        findings.push({
          file,
          message: `${name} must stay on Confect v9, found ${version}`,
        });
      }
      observed.set(`${file}:${name}`, version);
    }
  }
  const versions = new Set(observed.values());
  if (versions.size > 1) {
    findings.push({
      file: "package.json",
      message: `All @confect/* packages must share one exact v9 patch, found ${[...versions].sort().join(", ")}`,
    });
  }
  return findings;
};

export const checkNoAggregateConfectEntrypoints = (): readonly V9Finding[] =>
  ["spec.ts", "impl.ts", "nodeSpec.ts", "nodeImpl.ts"]
    .map((name) => `packages/convex/confect/${name}`)
    .filter((file) => existsSync(join(repoRoot, file)))
    .map((file) => ({
      file,
      message: "Confect v9 removes root aggregate spec/impl entrypoints.",
    }));

export const checkNoEffectBarrelImports = (): readonly V9Finding[] =>
  walk("packages/convex/confect")
    .filter((file) => file.endsWith(".ts"))
    .flatMap((file) => {
      const source = readFileSync(join(repoRoot, file), "utf8");
      return /from\s+["']effect["']/.test(source)
        ? [
            {
              file,
              message:
                "Import Effect submodules, not the effect barrel, inside confect/.",
            },
          ]
        : [];
    });

export const checkLazySpecSchemas = (): readonly V9Finding[] =>
  walk("packages/convex/confect")
    .filter((file) => file.endsWith(".spec.ts"))
    .flatMap((file) => {
      const source = readFileSync(join(repoRoot, file), "utf8");
      const findings: V9Finding[] = [];
      if (/GroupSpec\.make(Node)?\(\s*["']/.test(source)) {
        findings.push({
          file,
          message: "GroupSpec.make does not take a name in Confect v9.",
        });
      }
      for (const key of ["args", "returns", "error"] as const) {
        if (
          new RegExp(`${key}:\\s*Schema\\.`).test(source) ||
          new RegExp(`${key}:\\s*[A-Z][A-Za-z0-9_]*\\b`).test(source)
        ) {
          findings.push({
            file,
            message: `${key} schema must be wrapped in a () => thunk.`,
          });
        }
      }
      return findings;
    });

export const checkImplsUseDatabaseSchema = (): readonly V9Finding[] =>
  walk("packages/convex/confect")
    .filter((file) => file.endsWith(".impl.ts"))
    .flatMap((file) => {
      const source = readFileSync(join(repoRoot, file), "utf8");
      const findings: V9Finding[] = [];
      if (
        source.includes("FunctionImpl.make(api") ||
        source.includes("GroupImpl.make(api")
      ) {
        findings.push({
          file,
          message:
            "Impls must pass generated databaseSchema, not an aggregate api.",
        });
      }
      if (
        !/import\s+databaseSchema\s+from\s+["'][^"']*_generated\/schema["']/.test(
          source,
        )
      ) {
        findings.push({
          file,
          message: "Impls must import generated databaseSchema.",
        });
      }
      if (
        !/FunctionImpl\.make\(\s*databaseSchema/.test(source) &&
        source.includes("FunctionImpl.make(")
      ) {
        findings.push({
          file,
          message: "FunctionImpl.make must receive generated databaseSchema.",
        });
      }
      if (!/GroupImpl\.make\(\s*databaseSchema/.test(source)) {
        findings.push({
          file,
          message: "GroupImpl.make must receive generated databaseSchema.",
        });
      }
      if (!source.includes("GroupImpl.finalize")) {
        findings.push({
          file,
          message: "Impls must end with GroupImpl.finalize.",
        });
      }
      return findings;
    });

export const checkTableShape = (): readonly V9Finding[] =>
  walk("packages/convex/confect/tables")
    .filter((file) => file.endsWith(".ts"))
    .flatMap((file) => {
      const source = readFileSync(join(repoRoot, file), "utf8");
      const findings: V9Finding[] = [];
      if (!source.includes("export default Table.make(() =>")) {
        findings.push({
          file,
          message: "Tables must default-export Table.make(() => ...).",
        });
      }
      if (/Table\.make\(\s*["']/.test(source)) {
        findings.push({
          file,
          message:
            "Table.make no longer takes a table-name argument in Confect v9.",
        });
      }
      return findings;
    });

export const collectConfectV9Findings = (): readonly V9Finding[] => [
  ...checkConfectPackagePins(),
  ...checkNoAggregateConfectEntrypoints(),
  ...checkNoEffectBarrelImports(),
  ...checkLazySpecSchemas(),
  ...checkImplsUseDatabaseSchema(),
  ...checkTableShape(),
];

export const runConfectV9Check = (): void => {
  const findings = collectConfectV9Findings();
  if (findings.length === 0) {
    console.log("check:confect-v9 ok");
    return;
  }
  for (const finding of findings) {
    console.error(`${finding.file}: ${finding.message}`);
  }
  process.exitCode = 1;
};

if (isDirectRun(import.meta.url)) runConfectV9Check();
```

- [ ] **Step 3: Add tests for the v9 gate**

Create `tooling/quality/check-confect-v9.test.mts`:

```ts
import { describe, expect, it } from "vitest";

describe("check:confect-v9 source rules", () => {
  it("documents Confect v9 invariants in the gate source", async () => {
    const source = await import("node:fs/promises").then((fs) =>
      fs.readFile("tooling/quality/check-confect-v9.mts", "utf8"),
    );
    expect(source).toContain("checkNoEffectBarrelImports");
    expect(source).toContain("checkLazySpecSchemas");
    expect(source).toContain("checkImplsUseDatabaseSchema");
    expect(source).toContain("checkTableShape");
  });
});
```

- [ ] **Step 4: Add scripts and gate descriptor**

In root `package.json`, add:

```json
"check:confect-v9": "tsx tooling/quality/check-confect-v9.mts"
```

Then add `pnpm check:confect-v9` to the `verify` script immediately before
`pnpm check:confect-contracts`.

In `tooling/quality/src/check-definitions.mts`, add `check:confect-v9` to the
`config-drift` requirement list so CI self-protection pins the new gate name.

- [ ] **Step 5: Update rule coverage**

In `docs/rule-coverage.md`, add this row under "Layer law and contracts":

```markdown
| Preserve Confect v9 authoring model | mechanical: `check:confect-v9` verifies
v9 package pins, filesystem groups, lazy schema thunks, generated
`DatabaseSchema` impls, no aggregate entrypoints, lazy table definitions, and
submodule Effect imports |
```

- [ ] **Step 6: Update status ledger**

In `docs/template/effectification-status.md`, add this baseline line:

```markdown
- Confect v9 is the required baseline because its per-group generated registries
  keep Convex cold-start module evaluation proportional to the invoked group,
  not to the whole project.
```

- [ ] **Step 7: Run focused checks**

Run:

```bash
rtk pnpm --dir tooling/quality test check-confect-v9
rtk host-test-slot --class focused pnpm check:confect-v9
rtk host-test-slot --class focused pnpm check:confect-compat
```

Expected: all commands exit `0`. If `check:confect-v9` finds existing `effect`
barrel imports under `packages/convex/confect`, fix those imports in the same
task by replacing `import { Effect, Schema } from "effect"` with submodule
imports such as `import * as Effect from "effect/Effect"` and
`import * as Schema from "effect/Schema"`.

- [ ] **Step 8: Commit**

Run:

```bash
rtk git add package.json tooling/quality/check-confect-v9.mts tooling/quality/check-confect-v9.test.mts tooling/quality/src/check-definitions.mts docs/template/confect-effect-guide.md docs/template/effectification-status.md docs/rule-coverage.md packages/convex/confect && rtk git commit -m "feat: enforce Confect v9 baseline"
```

## Task 3: Add The Shared `@confect/test` Harness

**Files:**

- Create: `packages/convex/test/support/confect.ts`
- Create: `packages/convex/test/support/importMetaGlob.d.ts`
- Create: `packages/convex/test/support/expectEffect.ts`
- Modify: `packages/convex/package.json`

- [ ] **Step 1: Create Effect assertion helpers**

Create `packages/convex/test/support/expectEffect.ts`:

```ts
import { expect } from "vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";

export const expectEffectSuccess = async <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  provide: (effect: Effect.Effect<A, E, R>) => Effect.Effect<A>,
): Promise<A> => {
  const exit = await Effect.runPromiseExit(provide(effect));
  if (Exit.isFailure(exit)) {
    throw new Error(
      `Expected Effect success, received failure: ${String(exit.cause)}`,
    );
  }
  return exit.value;
};

export const expectTaggedFailure = async <
  A,
  E extends { readonly _tag: string },
  R,
>(
  effect: Effect.Effect<A, E, R>,
  provide: (effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E>,
  expectedTag: E["_tag"],
): Promise<E> => {
  const exit = await Effect.runPromiseExit(provide(effect));
  if (Exit.isSuccess(exit)) {
    throw new Error(`Expected Effect failure ${expectedTag}, received success`);
  }
  const failure = Cause.failureOption(exit.cause);
  if (failure._tag === "None") {
    throw new Error(
      `Expected typed Effect failure ${expectedTag}, received defect or interruption`,
    );
  }
  const captured = failure.value;
  expect(captured._tag).toBe(expectedTag);
  return captured;
};
```

- [ ] **Step 2: Create the TestConfect layer**

Create `packages/convex/test/support/confect.ts`:

```ts
import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import databaseSchema from "../../confect/_generated/schema";
import convexSchema from "../../confect/_generated/convexSchema";

export const testConfectLayer = TestConfect.layer(
  databaseSchema,
  convexSchema,
  import.meta.glob("../../convex/**/!(*.*.*)*.*s"),
);

export const withTestConfect = <A, E>(
  effect: Effect.Effect<A, E, TestConfect<typeof databaseSchema>>,
): Effect.Effect<A, E> => effect.pipe(Effect.provide(testConfectLayer()));

export const withTestConfectLayer = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
  layer: Layer.Layer<R, never, never>,
): Effect.Effect<A, E> => effect.pipe(Effect.provide(layer));
```

- [ ] **Step 2A: Add local `import.meta.glob` typing**

Create `packages/convex/test/support/importMetaGlob.d.ts` so `packages/convex`
does not need to depend on Vite only for types:

```ts
interface ImportMeta {
  glob<TModule = unknown>(
    pattern: string | readonly string[],
  ): Record<string, () => Promise<TModule>>;
}
```

Vitest provides the runtime transform for `import.meta.glob`; this local
declaration only makes `rtk pnpm --dir packages/convex typecheck` understand the
helper. If the package later adds direct Vite typings, remove this local
declaration in the same change.

- [ ] **Step 3: Add a test script alias**

In `packages/convex/package.json`, add this script:

```json
"test:contract": "vitest run test/*contract*.test.ts test/**/contract*.test.ts"
```

Keep the existing `"test": "vitest run --passWithNoTests"` script.

- [ ] **Step 4: Run the harness compile check**

Run:

```bash
rtk pnpm --dir packages/convex typecheck
rtk pnpm --dir packages/convex test:contract
```

Expected: both commands exit `0`. If TypeScript still reports `ImportMeta.glob`,
fix the local declaration before continuing. If the `import.meta.glob` pattern
misses generated functions, change it to
`import.meta.glob("../../convex/**/*.ts")` and rerun both commands.

- [ ] **Step 5: Commit**

Run:

```bash
rtk git add packages/convex/test/support/confect.ts packages/convex/test/support/importMetaGlob.d.ts packages/convex/test/support/expectEffect.ts packages/convex/package.json && rtk git commit -m "test: add confect contract harness"
```

## Task 4: Prove The Brain Pages Tenancy Gap With A Red Test

**Files:**

- Create: `packages/convex/test/support/seedTenancy.ts`
- Create: `packages/convex/test/brain-pages.contract.test.ts`

- [ ] **Step 1: Add deterministic tenancy seeding helpers**

Create `packages/convex/test/support/seedTenancy.ts`:

```ts
import * as Effect from "effect/Effect";
import { DatabaseWriter } from "../../confect/_generated/services";

export type SeededTenancy = {
  readonly organizationId: string;
  readonly workspaceId: string;
  readonly memberUserId: string;
  readonly outsiderUserId: string;
};

export const seedTenancy = (
  now: number,
): Effect.Effect<SeededTenancy, never, DatabaseWriter> =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    const organizationId = yield* writer
      .table("organizations")
      .insert({
        name: "Acme",
        slug: "acme",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const workspaceId = yield* writer
      .table("workspaces")
      .insert({
        organizationId,
        name: "Acme Workspace",
        slug: "acme-demo",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const memberUserId = yield* writer
      .table("users")
      .insert({
        subject: "member-subject",
        email: "member@example.com",
        name: "Member",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const outsiderUserId = yield* writer
      .table("users")
      .insert({
        subject: "outsider-subject",
        email: "outsider@example.com",
        name: "Outsider",
        status: "active",
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    yield* writer
      .table("workspaceMembers")
      .insert({
        workspaceId,
        userId: memberUserId,
        role: "editor",
        status: "active",
        acceptedAt: now,
        revokedAt: null,
        deletedAt: null,
        createdAt: now,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    return { organizationId, workspaceId, memberUserId, outsiderUserId };
  });
```

- [ ] **Step 2: Add the red contract test**

Create `packages/convex/test/brain-pages.contract.test.ts`:

```ts
import { TestConfect } from "@confect/test";
import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { MemberNotInWorkspace } from "../confect/errors";
import { seedTenancy } from "./support/seedTenancy";
import { testConfectLayer } from "./support/confect";

const now = 1_782_924_800_000;

describe("brain pages Confect contract", () => {
  it("rejects a workspace outsider before creating a markdown page", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now));
      return yield* confect
        .withIdentity({
          subject: "outsider-subject",
          email: "outsider@example.com",
        })
        .mutation(refs.public.brain.pages.createMarkdown, {
          workspaceId: seeded.workspaceId,
          slug: "outsider-note",
          title: "Outsider Note",
          markdown: "# nope",
        })
        .pipe(Effect.flip);
    });

    const error = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(error).toBeInstanceOf(MemberNotInWorkspace);
    expect(error._tag).toBe("MemberNotInWorkspace");
  });
});
```

- [ ] **Step 3: Run the red test**

Run:

```bash
rtk pnpm --dir packages/convex test brain-pages.contract.test.ts
```

Expected: FAIL because current `brain/pages.impl.ts` only checks workspace
existence and writes with `Date.now()`. If it fails earlier due to fixture field
drift, update `seedTenancy.ts` to match the exact table schemas in
`packages/convex/confect/tables/*`, rerun, and keep the final failure focused on
`MemberNotInWorkspace`.

- [ ] **Step 4: Commit the red test**

Run:

```bash
rtk git add packages/convex/test/support/seedTenancy.ts packages/convex/test/brain-pages.contract.test.ts && rtk git commit -m "test: expose brain page workspace access gap"
```

## Task 5: Add Public Error Families For Workspace Capabilities

**Files:**

- Create: `packages/convex/confect/capabilities/_kit/errors.ts`
- Create: `packages/convex/test/capability-kit-errors.test.ts`

- [ ] **Step 1: Create reusable error schemas**

Create `packages/convex/confect/capabilities/_kit/errors.ts`:

```ts
import * as Schema from "effect/Schema";
import {
  Forbidden,
  MemberNotInWorkspace,
  Unauthorized,
  ValidationFailed,
  WorkspaceNotFound,
} from "../../errors";

export const WorkspaceReadErrors = Schema.Union(
  Unauthorized,
  Forbidden,
  MemberNotInWorkspace,
  WorkspaceNotFound,
);

export const WorkspaceWriteErrors = Schema.Union(
  Unauthorized,
  Forbidden,
  MemberNotInWorkspace,
  WorkspaceNotFound,
  ValidationFailed,
);

export const workspaceErrorTags = [
  "Unauthorized",
  "Forbidden",
  "MemberNotInWorkspace",
  "WorkspaceNotFound",
  "ValidationFailed",
] as const;
```

- [ ] **Step 2: Add schema encoding tests**

Create `packages/convex/test/capability-kit-errors.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import {
  MemberNotInWorkspace,
  Unauthorized,
  WorkspaceNotFound,
} from "../confect/errors";
import {
  WorkspaceReadErrors,
  WorkspaceWriteErrors,
  workspaceErrorTags,
} from "../confect/capabilities/_kit/errors";

describe("capability kit public errors", () => {
  it("encodes workspace read errors as public tagged values", () => {
    expect(Schema.encodeSync(WorkspaceReadErrors)(new Unauthorized())).toEqual({
      _tag: "Unauthorized",
    });
    expect(
      Schema.encodeSync(WorkspaceReadErrors)(
        new MemberNotInWorkspace({ membershipId: "workspaceMembers_missing" }),
      ),
    ).toEqual({
      _tag: "MemberNotInWorkspace",
      membershipId: "workspaceMembers_missing",
    });
  });

  it("keeps the writable family a superset of read errors", () => {
    expect(
      Schema.encodeSync(WorkspaceWriteErrors)(
        new WorkspaceNotFound({ workspaceId: "workspaces_missing" }),
      ),
    ).toEqual({
      _tag: "WorkspaceNotFound",
      workspaceId: "workspaces_missing",
    });
    expect(workspaceErrorTags).toContain("ValidationFailed");
  });
});
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
rtk pnpm --dir packages/convex test capability-kit-errors.test.ts
rtk pnpm --dir packages/convex typecheck
```

Expected: both commands exit `0`.

- [ ] **Step 4: Commit**

Run:

```bash
rtk git add packages/convex/confect/capabilities/_kit/errors.ts packages/convex/test/capability-kit-errors.test.ts && rtk git commit -m "feat: add workspace capability error family"
```

## Task 6: Add Principal And Surface Policy Algebra

**Files:**

- Create: `packages/convex/confect/capabilities/_kit/principal.ts`
- Create: `packages/convex/confect/capabilities/_kit/surfaces.ts`
- Create: `packages/convex/test/capability-kit-surfaces.test.ts`

- [ ] **Step 1: Add principal schemas**

Create `packages/convex/confect/capabilities/_kit/principal.ts`:

```ts
import * as Schema from "effect/Schema";
import { Id } from "../../_generated/id";

export const Surface = Schema.Literal(
  "web",
  "api",
  "cli",
  "mcp",
  "workflow",
  "internal",
);
export type Surface = Schema.Schema.Type<typeof Surface>;

export const UserPrincipal = Schema.Struct({
  kind: Schema.Literal("user"),
  userId: Id("users"),
  subject: Schema.String,
  surface: Surface,
});

export const ApiKeyPrincipal = Schema.Struct({
  kind: Schema.Literal("apiKey"),
  apiKeyId: Id("apiKeys"),
  workspaceId: Id("workspaces"),
  surface: Schema.Literal("api", "cli", "mcp"),
});

export const SystemPrincipal = Schema.Struct({
  kind: Schema.Literal("system"),
  name: Schema.String,
  surface: Schema.Literal("workflow", "internal"),
});

export const Principal = Schema.Union(
  UserPrincipal,
  ApiKeyPrincipal,
  SystemPrincipal,
);
export type Principal = Schema.Schema.Type<typeof Principal>;
```

- [ ] **Step 2: Add deny-by-default surface policy**

Create `packages/convex/confect/capabilities/_kit/surfaces.ts`:

```ts
import * as Schema from "effect/Schema";
import { Surface, type Surface as SurfaceType } from "./principal";

export const SurfacePolicy = Schema.Struct({
  web: Schema.Boolean,
  api: Schema.Boolean,
  cli: Schema.Boolean,
  mcp: Schema.Boolean,
  workflow: Schema.Boolean,
  internal: Schema.Boolean,
});

export type SurfacePolicy = Schema.Schema.Type<typeof SurfacePolicy>;

export const denyAllSurfaces: SurfacePolicy = {
  web: false,
  api: false,
  cli: false,
  mcp: false,
  workflow: false,
  internal: false,
};

export const exposeSurfaces = (
  surfaces: readonly SurfaceType[],
): SurfacePolicy => ({
  ...denyAllSurfaces,
  ...Object.fromEntries(surfaces.map((surface) => [surface, true])),
});

export const assertSurfaceAllowed = (
  policy: SurfacePolicy,
  surface: SurfaceType,
): boolean => policy[surface] === true;

export const HeadlessSurface = Schema.Union(
  Schema.Literal("api"),
  Schema.Literal("cli"),
  Schema.Literal("mcp"),
);

export type HeadlessSurface = Schema.Schema.Type<typeof HeadlessSurface>;

export const allSurfaces: readonly SurfaceType[] = Surface.literals;
```

- [ ] **Step 3: Add policy tests**

Create `packages/convex/test/capability-kit-surfaces.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  assertSurfaceAllowed,
  denyAllSurfaces,
  exposeSurfaces,
} from "../confect/capabilities/_kit/surfaces";

describe("capability surface policy", () => {
  it("defaults to no exposure", () => {
    expect(assertSurfaceAllowed(denyAllSurfaces, "api")).toBe(false);
    expect(assertSurfaceAllowed(denyAllSurfaces, "web")).toBe(false);
  });

  it("exposes only listed surfaces", () => {
    const policy = exposeSurfaces(["web", "mcp"]);
    expect(assertSurfaceAllowed(policy, "web")).toBe(true);
    expect(assertSurfaceAllowed(policy, "mcp")).toBe(true);
    expect(assertSurfaceAllowed(policy, "api")).toBe(false);
    expect(assertSurfaceAllowed(policy, "cli")).toBe(false);
  });
});
```

- [ ] **Step 4: Run focused tests**

Run:

```bash
rtk pnpm --dir packages/convex test capability-kit-surfaces.test.ts
rtk pnpm --dir packages/convex typecheck
```

Expected: both commands exit `0`.

- [ ] **Step 5: Commit**

Run:

```bash
rtk git add packages/convex/confect/capabilities/_kit/principal.ts packages/convex/confect/capabilities/_kit/surfaces.ts packages/convex/test/capability-kit-surfaces.test.ts && rtk git commit -m "feat: add capability principal surfaces"
```

## Task 7: Add Workspace Access Resolver Backed By Confect Services

**Files:**

- Create: `packages/convex/confect/capabilities/_kit/workspaceAccess.ts`
- Create: `packages/convex/test/workspace-access.contract.test.ts`

- [ ] **Step 1: Implement the resolver**

Create `packages/convex/confect/capabilities/_kit/workspaceAccess.ts`:

```ts
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import { Auth, DatabaseReader } from "../../_generated/services";
import {
  MemberNotInWorkspace,
  Unauthorized,
  WorkspaceNotFound,
} from "../../errors";
import { resolveEffectiveWorkspaceRole } from "../../access/auth";
import { roleAtLeast, type Role } from "../../access/roles";
import type { Id } from "../../../convex/_generated/dataModel";

export type WorkspaceAccess = {
  readonly userId: Id<"users">;
  readonly workspaceId: Id<"workspaces">;
  readonly role: Role;
  readonly reason: string;
};

export const requireWorkspaceAccess = (
  workspaceId: Id<"workspaces">,
  minimumRole: Role,
): Effect.Effect<
  WorkspaceAccess,
  Unauthorized | WorkspaceNotFound | MemberNotInWorkspace,
  Auth | DatabaseReader
> =>
  Effect.gen(function* () {
    const auth = yield* Auth;
    const reader = yield* DatabaseReader;
    const identity = yield* auth.getUserIdentity.pipe(
      Effect.mapError(() => new Unauthorized()),
    );
    const user = yield* reader
      .table("users")
      .index("by_subject", (q) => q.eq("subject", identity.subject))
      .unique()
      .pipe(Effect.orDie);
    if (user === null) {
      return yield* Effect.fail(new Unauthorized());
    }
    const workspace = yield* reader
      .table("workspaces")
      .get(workspaceId)
      .pipe(Effect.orDie);
    if (workspace === null) {
      return yield* Effect.fail(new WorkspaceNotFound({ workspaceId }));
    }
    const organization = yield* reader
      .table("organizations")
      .get(workspace.organizationId)
      .pipe(Effect.orDie);
    const nowMs = yield* Clock.currentTimeMillis;
    const workspaceMembers = yield* reader
      .table("workspaceMembers")
      .index("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .collect()
      .pipe(Effect.orDie);
    const organizationMembers = yield* reader
      .table("organizationMembers")
      .index("by_organization", (q) =>
        q.eq("organizationId", workspace.organizationId),
      )
      .collect()
      .pipe(Effect.orDie);
    const resolution = resolveEffectiveWorkspaceRole({
      nowMs,
      userId: user._id,
      workspace: {
        id: workspace._id,
        organizationId: workspace.organizationId,
        status: workspace.status,
      },
      organization:
        organization === null
          ? undefined
          : {
              id: organization._id,
              status: organization.status,
            },
      workspaceMembers: workspaceMembers.map((member) => ({
        workspaceId: member.workspaceId,
        userId: member.userId,
        role: member.role,
        status: member.status,
        acceptedAt: member.acceptedAt,
        revokedAt: member.revokedAt,
        deletedAt: member.deletedAt,
      })),
      organizationMembers: organizationMembers.map((member) => ({
        organizationId: member.organizationId,
        userId: member.userId,
        role: member.role,
        status: member.status,
        acceptedAt: member.acceptedAt,
        revokedAt: member.revokedAt,
      })),
      guestGrants: [],
    });
    if (!resolution.ok || !roleAtLeast(resolution.role, minimumRole)) {
      return yield* Effect.fail(
        new MemberNotInWorkspace({
          membershipId: `${workspaceId}:${user._id}`,
        }),
      );
    }
    return {
      userId: user._id,
      workspaceId,
      role: resolution.role,
      reason: resolution.reason,
    };
  });
```

- [ ] **Step 2: Add resolver tests**

Create `packages/convex/test/workspace-access.contract.test.ts`:

```ts
import { TestConfect } from "@confect/test";
import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { MemberNotInWorkspace } from "../confect/errors";
import { seedTenancy } from "./support/seedTenancy";
import { testConfectLayer } from "./support/confect";

const now = 1_782_924_800_000;

describe("workspace access resolver through brain pages", () => {
  it("allows an active editor to create a page and rejects an outsider", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now));
      const pageId = yield* confect
        .withIdentity({
          subject: "member-subject",
          email: "member@example.com",
        })
        .mutation(refs.public.brain.pages.createMarkdown, {
          workspaceId: seeded.workspaceId,
          slug: "member-note",
          title: "Member Note",
          markdown: "# ok",
        });
      const outsiderError = yield* confect
        .withIdentity({
          subject: "outsider-subject",
          email: "outsider@example.com",
        })
        .mutation(refs.public.brain.pages.createMarkdown, {
          workspaceId: seeded.workspaceId,
          slug: "outsider-note",
          title: "Outsider Note",
          markdown: "# nope",
        })
        .pipe(Effect.flip);
      return { pageId, outsiderError };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.pageId).toMatch(/^brainPages_/);
    expect(result.outsiderError).toBeInstanceOf(MemberNotInWorkspace);
  });
});
```

- [ ] **Step 3: Run the test and watch it fail**

Run:

```bash
rtk pnpm --dir packages/convex test workspace-access.contract.test.ts
```

Expected: FAIL until Task 8 migrates `brain/pages.impl.ts` to
`requireWorkspaceAccess`.

- [ ] **Step 4: Commit the resolver and red test**

Run:

```bash
rtk git add packages/convex/confect/capabilities/_kit/workspaceAccess.ts packages/convex/test/workspace-access.contract.test.ts && rtk git commit -m "test: add workspace access resolver contract"
```

## Task 8: Migrate Brain Pages To Workspace Access And Effect Clock

**Files:**

- Modify: `packages/convex/confect/brain/pages.spec.ts`
- Modify: `packages/convex/confect/brain/pages.impl.ts`
- Modify: `packages/convex/test/brain-pages.contract.test.ts`
- Modify: `packages/convex/test/workspace-access.contract.test.ts`

- [ ] **Step 1: Expand declared typed errors**

In `packages/convex/confect/brain/pages.spec.ts`, replace the error imports and
error declarations with:

```ts
import {
  MemberNotInWorkspace,
  Unauthorized,
  WorkspaceNotFound,
} from "../errors";
```

```ts
error: () => Schema.Union(Unauthorized, MemberNotInWorkspace, WorkspaceNotFound),
```

Use the same error union for both `list` and `createMarkdown`.

- [ ] **Step 2: Use workspace access and Clock in the impl**

In `packages/convex/confect/brain/pages.impl.ts`:

```ts
import * as Clock from "effect/Clock";
import { requireWorkspaceAccess } from "../capabilities/_kit/workspaceAccess";
```

Delete `requireWorkspace`. In `list`, call:

```ts
yield * requireWorkspaceAccess(workspaceId, "viewer");
```

In `createMarkdown`, call:

```ts
yield * requireWorkspaceAccess(workspaceId, "editor");
const updatedAt = yield * Clock.currentTimeMillis;
```

Use `updatedAt` in the insert instead of `Date.now()`.

- [ ] **Step 3: Run Confect codegen**

Run:

```bash
rtk pnpm confect:codegen
rtk git diff -- packages/convex/confect/_generated packages/convex/convex/_generated packages/convex/convex/schema.ts
```

Expected: generated diffs reflect the widened brain page error union. There must
be no manual edits to generated files.

- [ ] **Step 4: Run the formerly red tests**

Run:

```bash
rtk pnpm --dir packages/convex test brain-pages.contract.test.ts workspace-access.contract.test.ts
rtk pnpm --dir packages/convex typecheck
```

Expected: both tests and typecheck exit `0`.

- [ ] **Step 5: Commit**

Run:

```bash
rtk git add packages/convex/confect/brain/pages.spec.ts packages/convex/confect/brain/pages.impl.ts packages/convex/confect/_generated packages/convex/convex/_generated packages/convex/convex/schema.ts packages/convex/test/brain-pages.contract.test.ts packages/convex/test/workspace-access.contract.test.ts && rtk git commit -m "feat: enforce brain page workspace access"
```

## Task 9: Convert Access Lifecycle Planners From Throwing To Either

**Files:**

- Modify: `packages/convex/confect/access/lifecycle.ts`
- Modify: `packages/convex/test/access-lifecycle.test.ts`

- [ ] **Step 1: Add lifecycle result types**

At the top of `packages/convex/confect/access/lifecycle.ts`, add:

```ts
import * as Either from "effect/Either";
```

After the `Patch` type, add:

```ts
export type AccessLifecycleError =
  | Forbidden
  | InvitationExpired
  | InvitationNotAccessible
  | InvitationNotPending
  | LastOwnerProtected
  | MemberNotInWorkspace
  | ValidationFailed;

export type PlannerResult<A> = Either.Either<A, AccessLifecycleError>;

const fail = (error: AccessLifecycleError): PlannerResult<never> =>
  Either.left(error);
const succeed = <A>(value: A): PlannerResult<A> => Either.right(value);
```

- [ ] **Step 2: Replace assertion helpers with `Either` helpers**

Replace each `throw new ...` helper with a function returning
`PlannerResult<void>` or `PlannerResult<Value>`. For example:

```ts
const requireLiveWorkspaceMember = (
  member: WorkspaceMemberLifecycleRef,
  workspaceId: string,
): PlannerResult<WorkspaceMemberLifecycleRef> => {
  if (
    member.workspaceId !== workspaceId ||
    member.status !== "active" ||
    member.acceptedAt === null ||
    member.revokedAt !== null ||
    member.deletedAt !== null
  ) {
    return fail(new MemberNotInWorkspace({ membershipId: member.id }));
  }
  return succeed(member);
};
```

Apply the same pattern to actor role checks, last-owner checks, normalized
email, accessible invitation, and pending invitation checks.

- [ ] **Step 3: Convert public planner functions**

Change each exported planner return type to `PlannerResult<...>`. Compose helper
results by early-returning `Either.left(...)` when a helper fails. Example
pattern:

```ts
const liveTarget = requireLiveWorkspaceMember(input.target, input.workspaceId);
if (Either.isLeft(liveTarget)) return liveTarget;
```

The success branch returns `succeed({ patch, events })`.

- [ ] **Step 4: Update tests from `toThrow` to Either assertions**

In `packages/convex/test/access-lifecycle.test.ts`, import:

```ts
import * as Either from "effect/Either";
```

Replace success assertions with:

```ts
const result = changeMemberRole({/* existing input */});
expect(Either.isRight(result)).toBe(true);
if (Either.isRight(result)) {
  expect(result.right.patch).toEqual(/* existing expected patch */);
}
```

Replace failure assertions with:

```ts
const result = removeMember({/* existing input */});
expect(Either.isLeft(result)).toBe(true);
if (Either.isLeft(result)) {
  expect(result.left).toBeInstanceOf(Forbidden);
}
```

- [ ] **Step 5: Run focused tests**

Run:

```bash
rtk pnpm --dir packages/convex test access-lifecycle.test.ts
rtk pnpm --dir packages/convex typecheck
```

Expected: both commands exit `0`; no lifecycle test uses `toThrow`.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add packages/convex/confect/access/lifecycle.ts packages/convex/test/access-lifecycle.test.ts && rtk git commit -m "refactor: return typed access lifecycle results"
```

## Task 10: Update Access Impls To Fail Through Effect Error Channels

**Files:**

- Modify: `packages/convex/confect/access/members.impl.ts`
- Modify: `packages/convex/confect/access/invitations.impl.ts`
- Modify: `packages/convex/confect/access/provisioning.impl.ts`
- Modify: access contract tests as needed under
  `packages/convex/test/*access*.test.ts`

- [ ] **Step 1: Add an Either-to-Effect bridge**

Create a local helper inside each impl file that calls lifecycle planners:

```ts
import * as Either from "effect/Either";

const fromPlanner = <A, E>(result: Either.Either<A, E>): Effect.Effect<A, E> =>
  Either.isLeft(result)
    ? Effect.fail(result.left)
    : Effect.succeed(result.right);
```

- [ ] **Step 2: Replace direct planner result access**

For every lifecycle call, use:

```ts
const plan = yield * fromPlanner(changeMemberRole({/* existing fields */}));
```

Then use `plan.patch`, `plan.patches`, `plan.invitationPatch`,
`plan.membershipInsert`, and `plan.events`.

- [ ] **Step 3: Keep declared error unions aligned**

Open these specs and ensure each declared `error` union includes every
`AccessLifecycleError` branch that its impl can fail with:

- `packages/convex/confect/access/members.spec.ts`
- `packages/convex/confect/access/invitations.spec.ts`
- `packages/convex/confect/access/provisioning.spec.ts`

If a branch is reachable in an impl, import the exact error class from
`../errors` and add it to `Schema.Union(...)`.

- [ ] **Step 4: Run codegen and tests**

Run:

```bash
rtk pnpm confect:codegen
rtk pnpm --dir packages/convex test access
rtk pnpm --dir packages/convex typecheck
```

Expected: tests and typecheck exit `0`; generated refs reflect any spec
error-union updates.

- [ ] **Step 5: Commit**

Run:

```bash
rtk git add packages/convex/confect/access packages/convex/confect/_generated packages/convex/convex/_generated packages/convex/convex/schema.ts packages/convex/test && rtk git commit -m "refactor: route access failures through Effect"
```

## Task 11: Replace Ambient Time In Database-Backed Impls

**Files:**

- Modify: `packages/convex/confect/access/provisioning.impl.ts`
- Modify: `packages/convex/confect/access/invitations.impl.ts`
- Modify: `packages/convex/confect/access/members.impl.ts`
- Modify: `packages/convex/confect/demo/showcase.impl.ts`
- Modify: `packages/convex/confect/shared/clock.ts`
- Modify: `packages/convex/confect/shared/determinism.ts`
- Modify: `packages/convex/test/shared-clock-nonce.test.ts`
- Modify: `docs/template/effectification-status.md` if Step 1A documents
  remaining fixture constants

- [ ] **Step 1: Replace `Date.now()` in persisted database-backed impls**

Apply this step to persisted paths only:

- `packages/convex/confect/access/provisioning.impl.ts`
- `packages/convex/confect/access/invitations.impl.ts`
- `packages/convex/confect/access/members.impl.ts`
- any remaining persisted `brain/pages.impl.ts` path not already migrated by
  Task 8

In each impl, import:

```ts
import * as Clock from "effect/Clock";
```

Replace:

```ts
const now = Date.now();
```

with:

```ts
const now = yield * Clock.currentTimeMillis;
```

Only perform this inside `Effect.gen` blocks. If a function is not inside
`Effect.gen`, wrap the body in `Effect.gen(function* () { ... })`.

- [ ] **Step 1A: Treat demo and compatibility fixtures separately**

`packages/convex/confect/demo/showcase.impl.ts` and
`packages/convex/confect/shared/determinism.ts` are template fixtures and
compatibility helpers, not the same class of persisted access impl. For these
files:

- if the value is persisted or appears in generated contract output, use the
  same `Clock.currentTimeMillis` pattern as Step 1;
- if the value exists only to keep deterministic demo output stable, replace it
  with an explicit named constant such as `const DEMO_NOW = 1_782_864_000_000`;
- document any remaining fixture constant in
  `docs/template/effectification-status.md`.

Do not silently make production persisted rows depend on demo constants.

- [ ] **Step 2: Convert shared clock helpers into Effect wrappers**

Replace `packages/convex/confect/shared/clock.ts` with:

```ts
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";

export const currentTimeMillis = Clock.currentTimeMillis;

export const currentDate = Clock.currentTimeMillis.pipe(
  Effect.map((now) => new Date(now)),
);

export const currentIso = Clock.currentTimeMillis.pipe(
  Effect.map((now) => new Date(now).toISOString()),
);
```

Keep `shared/determinism.ts` only if another non-Effect helper imports it after
this task. If no imports remain, delete `shared/determinism.ts` and update tests
accordingly.

- [ ] **Step 3: Update or remove the clock test**

If `shared/determinism.ts` is deleted, replace
`packages/convex/test/shared-clock-nonce.test.ts` with tests for
`shared/clock.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as Effect from "effect/Effect";
import * as TestClock from "effect/TestClock";
import { currentIso, currentTimeMillis } from "../confect/shared/clock";

describe("shared Effect clock helpers", () => {
  it("uses TestClock-controlled time", async () => {
    const program = Effect.gen(function* () {
      yield* TestClock.setTime(1_782_864_000_000);
      const now = yield* currentTimeMillis;
      const iso = yield* currentIso;
      return { now, iso };
    });
    const result = await Effect.runPromise(program);
    expect(result).toEqual({
      now: 1_782_864_000_000,
      iso: "2026-07-01T00:00:00.000Z",
    });
  });
});
```

- [ ] **Step 4: Add a direct scan gate for remaining ambient time in Confect
      impls**

Run:

```bash
rtk rg -n "Date\\.now\\(" packages/convex/confect
```

Expected: no matches in `.impl.ts` files. Matches in docs or pure compatibility
wrappers must be documented in `docs/template/effectification-status.md`.

- [ ] **Step 5: Run focused tests**

Run:

```bash
rtk pnpm --dir packages/convex test shared-clock-nonce.test.ts access brain demo
rtk pnpm --dir packages/convex typecheck
```

Expected: tests and typecheck exit `0`.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add packages/convex/confect/access packages/convex/confect/brain packages/convex/confect/demo packages/convex/confect/shared packages/convex/test docs/template/effectification-status.md && rtk git commit -m "refactor: use Effect clock in backend impls"
```

If Step 1A did not edit `docs/template/effectification-status.md`, omit that
path from the `git add` command so the commit does not fail on an unchanged or
absent file.

## Task 12: Add The Capability Builder Skeleton

**Files:**

- Create: `packages/convex/confect/capabilities/_kit/capability.ts`
- Create: `packages/convex/test/capability-builder.test.ts`

- [ ] **Step 1: Implement builder metadata and error-family composition**

Create `packages/convex/confect/capabilities/_kit/capability.ts`:

```ts
import { FunctionSpec } from "@confect/core";
import * as Schema from "effect/Schema";
import { WorkspaceReadErrors, WorkspaceWriteErrors } from "./errors";
import {
  type HeadlessSurface,
  exposeSurfaces,
  type SurfacePolicy,
} from "./surfaces";
import type { Role } from "../../access/roles";

export type CapabilityKind = "query" | "mutation" | "action";

export type CapabilityMeta = {
  readonly name: string;
  readonly kind: CapabilityKind;
  readonly minimumRole: Role;
  readonly surfaces: SurfacePolicy;
  readonly headless: readonly HeadlessSurface[];
  readonly idempotent: boolean;
};

export const capabilityMeta = (input: {
  readonly name: string;
  readonly kind: CapabilityKind;
  readonly minimumRole: Role;
  readonly headless?: readonly HeadlessSurface[];
  readonly idempotent?: boolean;
}): CapabilityMeta => ({
  name: input.name,
  kind: input.kind,
  minimumRole: input.minimumRole,
  headless: input.headless ?? [],
  surfaces: exposeSurfaces(input.headless ?? []),
  idempotent: input.idempotent ?? input.kind === "query",
});

export const publicErrorForKind = (kind: CapabilityKind) =>
  kind === "query" ? WorkspaceReadErrors : WorkspaceWriteErrors;

export const publicQuery = <
  Args extends Schema.Schema.AnyNoContext,
  Returns extends Schema.Schema.AnyNoContext,
>(input: {
  readonly name: string;
  readonly args: () => Args;
  readonly returns: () => Returns;
}) =>
  FunctionSpec.publicQuery({
    name: input.name,
    args: input.args,
    returns: input.returns,
    error: () => publicErrorForKind("query"),
  });

export const publicMutation = <
  Args extends Schema.Schema.AnyNoContext,
  Returns extends Schema.Schema.AnyNoContext,
>(input: {
  readonly name: string;
  readonly args: () => Args;
  readonly returns: () => Returns;
}) =>
  FunctionSpec.publicMutation({
    name: input.name,
    args: input.args,
    returns: input.returns,
    error: () => publicErrorForKind("mutation"),
  });

export const internalMutationStep = <
  Args extends Schema.Schema.AnyNoContext,
  Returns extends Schema.Schema.AnyNoContext,
>(input: {
  readonly name: string;
  readonly args: () => Args;
  readonly returns: () => Returns;
}) =>
  FunctionSpec.internalMutation({
    name: input.name,
    args: input.args,
    returns: input.returns,
    error: () => publicErrorForKind("mutation"),
  });
```

- [ ] **Step 2: Add builder tests**

Create `packages/convex/test/capability-builder.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as Schema from "effect/Schema";
import {
  capabilityMeta,
  publicErrorForKind,
} from "../confect/capabilities/_kit/capability";
import { Unauthorized, ValidationFailed } from "../confect/errors";

describe("capability builder", () => {
  it("denies headless exposure unless declared", () => {
    const meta = capabilityMeta({
      name: "draft",
      kind: "mutation",
      minimumRole: "editor",
    });
    expect(meta.headless).toEqual([]);
    expect(meta.surfaces.api).toBe(false);
  });

  it("uses read and write public error families", () => {
    expect(
      Schema.encodeSync(publicErrorForKind("query"))(new Unauthorized()),
    ).toEqual({ _tag: "Unauthorized" });
    expect(
      Schema.encodeSync(publicErrorForKind("mutation"))(
        new ValidationFailed({
          field: "idempotencyKey",
          message: "Required for external writes.",
        }),
      ),
    ).toEqual({
      _tag: "ValidationFailed",
      field: "idempotencyKey",
      message: "Required for external writes.",
    });
  });
});
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
rtk pnpm --dir packages/convex test capability-builder.test.ts
rtk pnpm --dir packages/convex typecheck
```

Expected: both commands exit `0`.

- [ ] **Step 4: Commit**

Run:

```bash
rtk git add packages/convex/confect/capabilities/_kit/capability.ts packages/convex/test/capability-builder.test.ts && rtk git commit -m "feat: add capability contract builder"
```

## Task 12A: Define The Effectified-Full Primitive Contract

**Files:**

- Create: `docs/template/primitive-contract.md`
- Create: `packages/template-core/src/primitiveContract.ts`
- Create: `packages/template-core/src/primitiveContract.test.ts`
- Modify: `packages/template-core/src/index.ts`
- Modify: `docs/template/confect-effect-guide.md`

- [ ] **Step 1: Write the copyable primitive contract guide**

Create `docs/template/primitive-contract.md`:

```md
# Effectified-Full Primitive Contract

A reusable template primitive is complete only when another app can copy the
primitive and keep its backend contract, workflow behavior, frontend state, and
headless surfaces intact.

## Required Contract Pack

Each primitive includes these pieces:

- Pure domain module with deterministic planners, reducers, schemas, or view
  derivation. It does not import Convex ctx, generated refs, React, provider
  SDKs, ambient time, random, or process env.
- Effect Schema arg, return, persisted-row, and public error schemas using
  Confect-compatible schema constructs.
- Confect v9 `*.spec.ts`/`*.impl.ts` pair with lazy schema thunks, generated
  table wrappers, generated `databaseSchema`, typed public errors, and
  `GroupImpl.finalize`.
- Internal workflow-step ref when the primitive can be called from
  `@convex-dev/workflow`.
- Effect service boundaries for config, clock, principal/auth, provider clients,
  storage, and observability.
- Generated surface manifest metadata for web, API, CLI, MCP, OpenAPI, and
  Scalar. Surface exposure defaults to none.
- Frontend view-model state when the primitive is visible in the app. React
  renderers consume view states; they do not import backend Effect programs.
- Tests for domain behavior, Confect typed errors, generated refs, manifest
  parity, workflow dispatch eligibility, and frontend view states.
- Authoring docs that name the runtime boundary, typed errors, surfaces,
  workflow-step eligibility, and copy checklist.

## Runtime Boundary

Effect and Confect define the contract layer. Pure domain modules and React
renderers stay plain TypeScript where that makes the primitive easier to reuse.
Workflow replay handlers stay plain Convex `defineWorkflow` files; Confect owns
start/status/control contracts and dispatchable capability refs.
```

- [ ] **Step 2: Add the portable primitive metadata shape**

Create `packages/template-core/src/primitiveContract.ts`:

```ts
export type PrimitiveSurface = "web" | "api" | "cli" | "mcp" | "workflow";

export type PrimitiveRuntime =
  | "domain"
  | "confect-query"
  | "confect-mutation"
  | "confect-action"
  | "convex-workflow"
  | "frontend-view-model"
  | "editor";

export type PrimitiveFileKind =
  | "domain"
  | "schema"
  | "spec"
  | "impl"
  | "workflow-handler"
  | "frontend-state"
  | "frontend-adapter"
  | "manifest"
  | "test"
  | "docs"
  | "quality-gate";

export type PrimitiveContractFile = {
  readonly kind: PrimitiveFileKind;
  readonly path: string;
  readonly responsibility: string;
};

export type PrimitiveContract = {
  readonly name: string;
  readonly namespace: string;
  readonly version: number;
  readonly runtimes: readonly PrimitiveRuntime[];
  readonly surfaces: readonly PrimitiveSurface[];
  readonly typedErrors: readonly string[];
  readonly files: readonly PrimitiveContractFile[];
  readonly effectServices: readonly string[];
  readonly hasInternalWorkflowStep: boolean;
  readonly uiStates: readonly string[];
};

export type PrimitiveContractFinding = {
  readonly field: keyof PrimitiveContract | "files";
  readonly message: string;
};

const hasFileKind = (
  contract: PrimitiveContract,
  kind: PrimitiveFileKind,
): boolean => contract.files.some((file) => file.kind === kind);

export const createPrimitiveContract = (
  contract: PrimitiveContract,
): PrimitiveContract => contract;

export const checkPrimitiveContract = (
  contract: PrimitiveContract,
): readonly PrimitiveContractFinding[] => {
  const findings: PrimitiveContractFinding[] = [];

  if (contract.name.trim() === "") {
    findings.push({ field: "name", message: "Primitive name is required." });
  }
  if (contract.namespace.trim() === "") {
    findings.push({
      field: "namespace",
      message: "Primitive namespace is required.",
    });
  }
  if (contract.version < 1) {
    findings.push({
      field: "version",
      message: "Primitive version must be at least 1.",
    });
  }
  if (!hasFileKind(contract, "domain")) {
    findings.push({
      field: "files",
      message: "Each primitive needs a pure domain or view-model file.",
    });
  }
  if (
    contract.runtimes.some((runtime) => runtime.startsWith("confect-")) &&
    (!hasFileKind(contract, "spec") || !hasFileKind(contract, "impl"))
  ) {
    findings.push({
      field: "files",
      message: "Confect primitives need both spec and impl files.",
    });
  }
  if (contract.surfaces.length > 0 && !hasFileKind(contract, "manifest")) {
    findings.push({
      field: "files",
      message: "Exposed primitives need manifest metadata.",
    });
  }
  if (
    contract.hasInternalWorkflowStep &&
    !hasFileKind(contract, "workflow-handler")
  ) {
    findings.push({
      field: "files",
      message:
        "Workflow-step primitives need a workflow handler or dispatch file.",
    });
  }
  if (
    contract.uiStates.length > 0 &&
    !hasFileKind(contract, "frontend-state")
  ) {
    findings.push({
      field: "files",
      message: "UI-visible primitives need a frontend state file.",
    });
  }

  return findings;
};
```

- [ ] **Step 3: Export the primitive contract helpers**

Append to `packages/template-core/src/index.ts`:

```ts
export {
  checkPrimitiveContract,
  createPrimitiveContract,
  type PrimitiveContract,
  type PrimitiveContractFile,
  type PrimitiveContractFinding,
  type PrimitiveFileKind,
  type PrimitiveRuntime,
  type PrimitiveSurface,
} from "./primitiveContract";
```

- [ ] **Step 4: Add primitive contract tests**

Create `packages/template-core/src/primitiveContract.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  checkPrimitiveContract,
  createPrimitiveContract,
  type PrimitiveContract,
} from "./primitiveContract";

const fullContract: PrimitiveContract = createPrimitiveContract({
  name: "sourceGroundedBrief",
  namespace: "capabilities.sourceGroundedBrief",
  version: 1,
  runtimes: ["domain", "confect-mutation", "frontend-view-model"],
  surfaces: ["web", "workflow", "internal"],
  typedErrors: ["Unauthorized", "ValidationFailed", "Forbidden"],
  effectServices: ["Principal", "Clock", "Observability"],
  hasInternalWorkflowStep: true,
  uiStates: ["loading", "ready", "typed_failure", "transport_failure"],
  files: [
    {
      kind: "domain",
      path: "packages/convex/confect/capabilities/sourceGroundedBrief.domain.ts",
      responsibility: "Pure deterministic capability planning.",
    },
    {
      kind: "spec",
      path: "packages/convex/confect/capabilities/sourceGroundedBrief.spec.ts",
      responsibility: "Confect public and internal function contract.",
    },
    {
      kind: "impl",
      path: "packages/convex/confect/capabilities/sourceGroundedBrief.impl.ts",
      responsibility: "Effectful Confect implementation.",
    },
    {
      kind: "workflow-handler",
      path: "packages/convex/confect/capabilities/sourceGroundedBrief.impl.ts",
      responsibility: "Internal mutation step emitted by the same group.",
    },
    {
      kind: "frontend-state",
      path: "apps/web/src/adapters/confect-state.ts",
      responsibility: "Typed UI state normalization.",
    },
    {
      kind: "manifest",
      path: "packages/template-core/src/generated/confectManifest.ts",
      responsibility: "Generated surface metadata.",
    },
  ],
});

describe("primitive contract metadata", () => {
  it("accepts a complete effectified-full primitive", () => {
    expect(checkPrimitiveContract(fullContract)).toEqual([]);
  });

  it("reports missing files instead of relying on tribal knowledge", () => {
    const findings = checkPrimitiveContract({
      ...fullContract,
      files: fullContract.files.filter((file) => file.kind !== "manifest"),
    });

    expect(findings).toEqual([
      {
        field: "files",
        message: "Exposed primitives need manifest metadata.",
      },
    ]);
  });
});
```

- [ ] **Step 5: Link the primitive doctrine from the Confect guide**

Append to `docs/template/confect-effect-guide.md`:

```md
## Effectified-Full Primitives

Reusable primitives follow `docs/template/primitive-contract.md`. A primitive is
not considered template-ready when it only has a Confect function. It also needs
the pure domain boundary, typed errors, service boundaries, manifest metadata,
workflow-step eligibility when dispatchable, frontend state when visible, tests,
gates, and docs.
```

- [ ] **Step 6: Run focused template-core checks**

Run:

```bash
rtk pnpm --dir packages/template-core test primitiveContract.test.ts
rtk pnpm --dir packages/template-core typecheck
rtk host-test-slot --class focused pnpm check:docs-freshness
```

Expected: every command exits `0`.

- [ ] **Step 7: Commit**

Run:

```bash
rtk git add docs/template/primitive-contract.md docs/template/confect-effect-guide.md packages/template-core/src/primitiveContract.ts packages/template-core/src/primitiveContract.test.ts packages/template-core/src/index.ts && rtk git commit -m "docs: define effectified primitive contracts"
```

## Task 13: Migrate One Existing Capability Onto The Builder

**Files:**

- Modify: `packages/convex/confect/capabilities/sourceGroundedBrief.spec.ts`
- Modify: `packages/convex/confect/capabilities/sourceGroundedBrief.impl.ts`
- Modify: `packages/convex/test/source-grounded-brief.test.ts`

- [ ] **Step 1: Replace direct `FunctionSpec.publicMutation` with builder
      helper**

In `sourceGroundedBrief.spec.ts`, import:

```ts
import { internalMutationStep, publicMutation } from "./_kit/capability";
```

Replace the `FunctionSpec.publicMutation({ ... })` declaration for `run` with:

```ts
const run = publicMutation({
  name: "run",
  args: () => RunArgs,
  returns: () => RunReturns,
});

const runInternal = internalMutationStep({
  name: "runInternal",
  args: () => RunArgs,
  returns: () => RunReturns,
});
```

Keep existing domain-specific arg and return schemas. Remove any narrower public
error union that conflicts with `WorkspaceWriteErrors`. Export both functions
from the group:

```ts
export default GroupSpec.make().addFunction(run).addFunction(runInternal);
```

- [ ] **Step 2: Enforce workspace access in the impl**

In `sourceGroundedBrief.impl.ts`, import:

```ts
import { requireWorkspaceAccess } from "./_kit/workspaceAccess";
```

Before building the deterministic response, call:

```ts
yield * requireWorkspaceAccess(workspaceId, "editor");
```

If the current args use `workspaceSlug` instead of `workspaceId`, change the
args schema to accept `workspaceId: Id("workspaces")` and update all tests and
docs that call `sourceGroundedBrief.run`. Implement both `run` and `runInternal`
with the same domain function so workflow steps call the internal ref and
web/API/CLI callers use the public ref.

- [ ] **Step 3: Run codegen and focused tests**

Run:

```bash
rtk pnpm confect:codegen
rtk pnpm --dir packages/convex test source-grounded-brief.test.ts capability-builder.test.ts
rtk pnpm --dir packages/convex typecheck
```

Expected: tests and typecheck exit `0`; generated refs compile.

- [ ] **Step 4: Commit**

Run:

```bash
rtk git add packages/convex/confect/capabilities/sourceGroundedBrief.spec.ts packages/convex/confect/capabilities/sourceGroundedBrief.impl.ts packages/convex/confect/_generated packages/convex/convex/_generated packages/convex/convex/schema.ts packages/convex/test/source-grounded-brief.test.ts && rtk git commit -m "feat: route brief capability through builder"
```

## Task 14: Generate A Confect Contract Manifest

**Files:**

- Create: `tooling/confect-manifest/package.json`
- Create: `tooling/confect-manifest/tsconfig.json`
- Create: `tooling/confect-manifest/src/index.ts`
- Create: `tooling/confect-manifest/src/index.test.ts`
- Modify: `package.json`

- [ ] **Step 1: Add the manifest package**

Create `tooling/confect-manifest/package.json`:

```json
{
  "name": "@maestro-template/confect-manifest-tooling",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "typecheck": "tsc -p tsconfig.json --noEmit"
  },
  "dependencies": {
    "@maestro-template/template-core": "workspace:*",
    "effect": "3.21.4"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "typescript": "^5.0.0",
    "vitest": "^3.0.0"
  }
}
```

- [ ] **Step 1A: Add the manifest package TypeScript config**

Create `tooling/confect-manifest/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": ".",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "src/**/*.mts", "src/**/*.tsx"]
}
```

- [ ] **Step 2: Add the manifest shape**

Create `tooling/confect-manifest/src/index.ts`:

```ts
export type ContractFunctionKind = "query" | "mutation" | "action";
export type ContractSurface =
  "api" | "cli" | "mcp" | "web" | "workflow" | "internal";

export type ContractFunctionManifest = {
  readonly namespace: string;
  readonly name: string;
  readonly operationId: string;
  readonly kind: ContractFunctionKind;
  readonly surfaces: readonly ContractSurface[];
  readonly typedErrors: readonly string[];
  readonly idempotent: boolean;
  readonly argsSchemaName: string;
  readonly returnsSchemaName: string;
};

export type ContractManifest = {
  readonly version: 1;
  readonly generatedAt: string;
  readonly functions: readonly ContractFunctionManifest[];
};

export const buildContractManifest = (
  functions: readonly ContractFunctionManifest[],
  generatedAt = "1970-01-01T00:00:00.000Z",
): ContractManifest => ({
  version: 1,
  generatedAt,
  functions: [...functions].sort((left, right) =>
    left.operationId.localeCompare(right.operationId),
  ),
});

export const manifestOperationIds = (
  manifest: ContractManifest,
): readonly string[] => manifest.functions.map((entry) => entry.operationId);
```

This first package defines the shape and sorting rules only. It must not create
`packages/template-core/src/generated/confectManifest.ts`; Task 15 creates the
generated artifact, and Task 16 removes the temporary bootstrap list by binding
manifest metadata to actual Confect function specs.

- [ ] **Step 3: Add tests**

Create `tooling/confect-manifest/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildContractManifest, manifestOperationIds } from "./index";

describe("confect manifest tooling", () => {
  it("sorts operation ids for deterministic output", () => {
    const manifest = buildContractManifest([
      {
        namespace: "b",
        name: "run",
        operationId: "b.run",
        kind: "mutation",
        surfaces: ["api"],
        typedErrors: ["Unauthorized"],
        idempotent: false,
        argsSchemaName: "b.run.args",
        returnsSchemaName: "b.run.returns",
      },
      {
        namespace: "a",
        name: "list",
        operationId: "a.list",
        kind: "query",
        surfaces: ["web"],
        typedErrors: ["WorkspaceNotFound"],
        idempotent: true,
        argsSchemaName: "a.list.args",
        returnsSchemaName: "a.list.returns",
      },
    ]);

    expect(manifestOperationIds(manifest)).toEqual(["a.list", "b.run"]);
  });
});
```

- [ ] **Step 4: Add root scripts**

In root `package.json`, add only the check script:

```json
"check:confect-manifest": "pnpm --dir tooling/confect-manifest test && pnpm --dir tooling/confect-manifest typecheck"
```

Do not add `confect:manifest` until Task 15 creates
`tooling/confect-manifest/src/generate.ts`. A root script pointing at a missing
generator is not allowed.

- [ ] **Step 5: Run tests**

Run:

```bash
rtk pnpm --dir tooling/confect-manifest test
rtk pnpm --dir tooling/confect-manifest typecheck
```

Expected: both commands exit `0`.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add package.json tooling/confect-manifest && rtk git commit -m "feat: add Confect manifest tooling"
```

## Task 15: Wire Manifest Generation To Confect Specs

**Files:**

- Create: `tooling/confect-manifest/src/generate.ts`
- Create: `packages/template-core/src/generated/confectManifest.ts`
- Modify: `tooling/confect-manifest/src/index.test.ts`
- Modify: `package.json`
- Modify: `packages/template-core/package.json`
- Modify: `docs/template/confect-effect-guide.md`

- [ ] **Step 1: Implement a deterministic generator**

Create `tooling/confect-manifest/src/generate.ts`:

```ts
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { mkdirSync } from "node:fs";
import { buildContractManifest, type ContractFunctionManifest } from "./index";

const functions: readonly ContractFunctionManifest[] = [
  {
    namespace: "brain.pages",
    name: "list",
    operationId: "brain.pages.list",
    kind: "query",
    surfaces: ["web"],
    typedErrors: ["Unauthorized", "MemberNotInWorkspace", "WorkspaceNotFound"],
    idempotent: true,
    argsSchemaName: "brain.pages.list.args",
    returnsSchemaName: "brain.pages.list.returns",
  },
  {
    namespace: "brain.pages",
    name: "createMarkdown",
    operationId: "brain.pages.createMarkdown",
    kind: "mutation",
    surfaces: ["web", "api", "cli", "mcp"],
    typedErrors: [
      "Unauthorized",
      "MemberNotInWorkspace",
      "WorkspaceNotFound",
      "ValidationFailed",
    ],
    idempotent: false,
    argsSchemaName: "brain.pages.createMarkdown.args",
    returnsSchemaName: "brain.pages.createMarkdown.returns",
  },
];

const manifest = buildContractManifest(functions);
const target = resolve(
  "packages/template-core/src/generated/confectManifest.ts",
);
mkdirSync(dirname(target), { recursive: true });
writeFileSync(
  target,
  `/* Generated by pnpm confect:manifest. Do not edit by hand. */\n\nexport const confectManifest = ${JSON.stringify(manifest, null, 2)} as const;\n\nexport type ConfectManifest = typeof confectManifest;\n`,
);
```

This generator starts with explicit entries for the first migrated contract
family as a bootstrap fixture only. Nothing in API, CLI, MCP, or HTTP may treat
this bootstrap output as production execution authority until Task 16 proves
manifest/spec parity and Task 18 invokes real generated refs.

- [ ] **Step 1A: Expose the generated manifest subpath**

In `packages/template-core/package.json`, add explicit source exports so
workspace packages can import
`@maestro-template/template-core/generated/confectManifest`:

```json
"exports": {
  ".": {
    "types": "./src/index.ts",
    "default": "./src/index.ts"
  },
  "./generated/confectManifest": {
    "types": "./src/generated/confectManifest.ts",
    "default": "./src/generated/confectManifest.ts"
  }
}
```

Keep the existing `main` and `types` fields unless the repo already uses package
`exports` elsewhere and the local convention says to replace them.

- [ ] **Step 2: Generate the first manifest artifact**

Run:

```bash
rtk pnpm confect:manifest
rtk sed -n '1,160p' packages/template-core/src/generated/confectManifest.ts
```

Expected: the generated file contains `brain.pages.list` and
`brain.pages.createMarkdown`, sorted by `operationId`.

- [ ] **Step 3: Add manifest drift to root checks**

In root `package.json`, add:

```json
"confect:manifest": "tsx tooling/confect-manifest/src/generate.ts"
```

Then add `pnpm check:confect-manifest` before
`pnpm check:headless-surface-contract` in the `verify` script. After the
generator exists, upgrade the `check:confect-manifest` script from Task 14 so it
proves deterministic output, not only unit tests:

```json
"check:confect-manifest": "pnpm --dir tooling/confect-manifest test && pnpm --dir tooling/confect-manifest typecheck && pnpm confect:manifest && git diff --exit-code packages/template-core/src/generated/confectManifest.ts"
```

Do this only after `tooling/confect-manifest/src/generate.ts` exists. Task 14's
earlier test/typecheck-only script is intentionally temporary.

- [ ] **Step 4: Document the bootstrap limitation**

In `docs/template/effectification-status.md`, add a row under "Known Gaps Being
Closed":

```markdown
- The initial manifest generator starts with explicit operation metadata for the
  first migrated group; Task 16 removes this bootstrap list by reading
  capability builder metadata.
```

- [ ] **Step 5: Run manifest checks**

Run:

```bash
rtk host-test-slot --class focused pnpm check:confect-manifest
rtk pnpm confect:manifest
rtk git diff --exit-code packages/template-core/src/generated/confectManifest.ts
```

Expected: all commands exit `0`.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add package.json packages/template-core/package.json tooling/confect-manifest packages/template-core/src/generated/confectManifest.ts docs/template/effectification-status.md && rtk git commit -m "feat: generate initial contract manifest"
```

## Task 16: Move Manifest Metadata Into Capability Specs

**Files:**

- Modify: `packages/convex/confect/capabilities/_kit/capability.ts`
- Modify: `packages/convex/confect/brain/pages.spec.ts`
- Modify: `packages/convex/confect/capabilities/sourceGroundedBrief.spec.ts`
- Modify: `tooling/confect-manifest/src/generate.ts`
- Modify: `tooling/confect-manifest/src/index.ts`
- Modify: `tooling/confect-manifest/src/index.test.ts`

- [ ] **Step 1: Add a spec-bound manifest helper**

In `packages/convex/confect/capabilities/_kit/capability.ts`, add helpers that
force metadata to be declared at the same site as the `FunctionSpec`, instead of
allowing free-floating manifest arrays to drift:

```ts
import type * as Schema from "effect/Schema";

export type ContractSurface =
  "api" | "cli" | "mcp" | "web" | "workflow" | "internal";
export type ContractFunctionKind = "query" | "mutation" | "action";

export type SerializableContractMetadata = {
  readonly namespace: string;
  readonly name: string;
  readonly operationId: string;
  readonly kind: ContractFunctionKind;
  readonly surfaces: readonly ContractSurface[];
  readonly typedErrors: readonly string[];
  readonly idempotent: boolean;
  readonly argsSchemaName: string;
  readonly returnsSchemaName: string;
};

export type ContractSpecMetadata = SerializableContractMetadata & {
  readonly argsSchema: Schema.Schema.Any;
  readonly returnsSchema: Schema.Schema.Any;
};

export type ContractSchemaRegistry = Readonly<
  Record<string, Schema.Schema.Any>
>;

export type ManifestBoundFunction<Spec> = {
  readonly spec: Spec;
  readonly manifest: ContractSpecMetadata;
};

export const defineContractFunction = <Spec>(
  spec: Spec,
  manifest: ContractSpecMetadata,
): ManifestBoundFunction<Spec> => ({ spec, manifest });

export const collectContractManifest = (
  functions: readonly ManifestBoundFunction<unknown>[],
): readonly SerializableContractMetadata[] =>
  functions.map((entry) => {
    const {
      argsSchema: _argsSchema,
      returnsSchema: _returnsSchema,
      ...serializable
    } = entry.manifest;
    return serializable;
  });

export const collectContractSchemas = (
  functions: readonly ManifestBoundFunction<unknown>[],
): ContractSchemaRegistry =>
  Object.fromEntries(
    functions.flatMap((entry) => [
      [entry.manifest.argsSchemaName, entry.manifest.argsSchema],
      [entry.manifest.returnsSchemaName, entry.manifest.returnsSchema],
    ]),
  );
```

`ContractFunctionManifest` in `tooling/confect-manifest/src/index.ts` remains
the serializable shape: schema names and, after Task 31, generated JSON Schema
objects. It must not include live Effect schema handles. The helper above keeps
the live handles spec-bound so the generator can project JSON Schema later.

- [ ] **Step 2: Bind Brain pages specs to manifest metadata**

In `brain/pages.spec.ts`, wrap the existing function spec definitions:

```ts
const list = defineContractFunction(
  FunctionSpec.publicQuery({
    name: "list",
    args: () => ListArgs,
    returns: () => ListReturns,
    error: () => BrainPagesReadError,
  }),
  {
    namespace: "brain.pages",
    name: "list",
    operationId: "brain.pages.list",
    kind: "query",
    surfaces: ["web"],
    typedErrors: ["Unauthorized", "MemberNotInWorkspace", "WorkspaceNotFound"],
    idempotent: true,
    argsSchemaName: "brain.pages.list.args",
    returnsSchemaName: "brain.pages.list.returns",
    argsSchema: ListArgs,
    returnsSchema: ListReturns,
  },
);

const createMarkdown = defineContractFunction(
  FunctionSpec.publicMutation({
    name: "createMarkdown",
    args: () => CreateMarkdownArgs,
    returns: () => CreateMarkdownReturns,
    error: () => BrainPagesWriteError,
  }),
  {
    namespace: "brain.pages",
    name: "createMarkdown",
    operationId: "brain.pages.createMarkdown",
    kind: "mutation",
    surfaces: ["web", "api", "cli", "mcp"],
    typedErrors: [
      "Unauthorized",
      "MemberNotInWorkspace",
      "WorkspaceNotFound",
      "ValidationFailed",
    ],
    idempotent: false,
    argsSchemaName: "brain.pages.createMarkdown.args",
    returnsSchemaName: "brain.pages.createMarkdown.returns",
    argsSchema: CreateMarkdownArgs,
    returnsSchema: CreateMarkdownReturns,
  },
);

const contractFunctions = [list, createMarkdown] as const;
export const manifest = collectContractManifest(contractFunctions);
export const schemaRegistry = collectContractSchemas(contractFunctions);

export default GroupSpec.make()
  .addFunction(list.spec)
  .addFunction(createMarkdown.spec);
```

Do the same for `sourceGroundedBrief.spec.ts`. Its first spec-bound manifest
entries should use `surfaces: ["web", "workflow", "internal"]` unless the same
task also adds API/CLI/MCP generated ref mappings and tests. Do not export
handwritten manifest entries that are not tied to a `FunctionSpec`.

- [ ] **Step 3: Update generator to import bound spec manifests**

In `tooling/confect-manifest/src/generate.ts`, replace the hard-coded
`functions` array with imports:

```ts
import { manifest as brainPagesManifest } from "../../../packages/convex/confect/brain/pages.spec";
import { schemaRegistry as brainPagesSchemas } from "../../../packages/convex/confect/brain/pages.spec";
import { manifest as sourceGroundedBriefManifest } from "../../../packages/convex/confect/capabilities/sourceGroundedBrief.spec";
import { schemaRegistry as sourceGroundedBriefSchemas } from "../../../packages/convex/confect/capabilities/sourceGroundedBrief.spec";
import {
  mergeContractSchemaRegistries,
  missingSchemasForManifest,
} from "./index";

const functions = [...brainPagesManifest, ...sourceGroundedBriefManifest];
const schemas = mergeContractSchemaRegistries(
  brainPagesSchemas,
  sourceGroundedBriefSchemas,
);
const missingSchemas = missingSchemasForManifest(functions, schemas);
if (missingSchemas.length > 0) {
  throw new Error(
    `Missing Effect schema handles: ${missingSchemas.join(", ")}`,
  );
}
```

- [ ] **Step 4: Add a duplicate operation and generated-ref parity guard**

In `tooling/confect-manifest/src/index.ts`, add:

```ts
import type * as Schema from "effect/Schema";

export type ContractSchemaRegistry = Readonly<
  Record<string, Schema.Schema.Any>
>;

export const duplicateOperationIds = (
  functions: readonly ContractFunctionManifest[],
): readonly string[] => {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const entry of functions) {
    if (seen.has(entry.operationId)) duplicates.add(entry.operationId);
    seen.add(entry.operationId);
  }
  return [...duplicates].sort();
};

export const mergeContractSchemaRegistries = (
  ...registries: readonly ContractSchemaRegistry[]
): ContractSchemaRegistry => Object.assign({}, ...registries);

export const missingSchemasForManifest = (
  functions: readonly ContractFunctionManifest[],
  schemas: ContractSchemaRegistry,
): readonly string[] =>
  [
    ...new Set(
      functions.flatMap((entry) => [
        entry.argsSchemaName,
        entry.returnsSchemaName,
      ]),
    ),
  ]
    .filter((schemaName) => schemas[schemaName] === undefined)
    .sort();
```

In `generate.ts`, before writing:

```ts
const duplicates = duplicateOperationIds(functions);
if (duplicates.length > 0) {
  throw new Error(`Duplicate operation ids: ${duplicates.join(", ")}`);
}
```

Also add a generator assertion that every manifest operation has a matching
generated Confect ref name after `rtk pnpm confect:codegen`. If direct generated
ref import causes runtime side effects in the tooling process, move the parity
check into `tooling/quality/check-confect-manifest.mts` and document why.

- [ ] **Step 5: Run codegen, manifest generation, and tests**

Run:

```bash
rtk pnpm confect:codegen
rtk pnpm confect:manifest
rtk host-test-slot --class focused pnpm check:confect-manifest
rtk pnpm --dir packages/convex typecheck
```

Expected: all commands exit `0`; generated manifest remains deterministic and
every operation is backed by a generated ref/spec.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add packages/convex/confect packages/convex/confect/_generated packages/convex/convex/_generated packages/convex/convex/schema.ts tooling/confect-manifest packages/template-core/src/generated/confectManifest.ts && rtk git commit -m "feat: derive manifest from spec metadata"
```

## Task 17: Add A Kind-Aware Uniform Headless Executor

**Files:**

- Create: `packages/convex/confect/manifest/executor.ts`
- Create: `packages/convex/test/headless-executor.test.ts`
- Modify: `packages/convex/confect/http.ts`

- [ ] **Step 1: Implement operation resolution and real-dispatch adapter types**

Create `packages/convex/confect/manifest/executor.ts`:

```ts
import { confectManifest } from "@maestro-template/template-core/generated/confectManifest";

export type HeadlessExecutorRequest = {
  readonly operationId: string;
  readonly surface: "api" | "cli" | "mcp";
  readonly input: Record<string, unknown>;
  readonly idempotencyKey?: string;
};

export type HeadlessFailureResult = {
  readonly ok: false;
  readonly error: { readonly _tag: string; readonly message: string };
};

export type JsonValue =
  | null
  | string
  | number
  | boolean
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type HeadlessExecutorResult =
  | {
      readonly ok: true;
      readonly operationId: string;
      readonly result: JsonValue;
    }
  | HeadlessFailureResult;

export type HeadlessExecutionAdapter = {
  readonly refs: Readonly<Record<string, unknown>>;
  readonly runQuery: (
    ref: unknown,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly runMutation: (
    ref: unknown,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly runAction: (
    ref: unknown,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
};

const isJsonValue = (value: unknown): value is JsonValue => {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return true;
  }
  if (Array.isArray(value)) return value.every(isJsonValue);
  if (typeof value !== "object") return false;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  return Object.values(value as Record<string, unknown>).every(isJsonValue);
};

export const findHeadlessOperation = (
  operationId: string,
  surface: HeadlessExecutorRequest["surface"],
) =>
  confectManifest.functions.find(
    (entry) =>
      entry.operationId === operationId && entry.surfaces.includes(surface),
  );

export const resolveHeadlessOperation = (
  request: HeadlessExecutorRequest,
):
  | {
      readonly ok: true;
      readonly operation: (typeof confectManifest.functions)[number];
    }
  | HeadlessFailureResult => {
  const operation = findHeadlessOperation(request.operationId, request.surface);
  if (!operation) {
    return {
      ok: false,
      error: {
        _tag: "NotFound",
        message: `Unknown or unexposed operation: ${request.operationId}`,
      },
    };
  }
  return { ok: true, operation };
};

export const executeHeadlessOperation = async (
  adapter: HeadlessExecutionAdapter,
  request: HeadlessExecutorRequest,
): Promise<HeadlessExecutorResult> => {
  const resolved = resolveHeadlessOperation(request);
  if (!resolved.ok) return resolved;
  const { operation } = resolved;
  if (!operation.idempotent && !request.idempotencyKey?.trim()) {
    return {
      ok: false,
      error: {
        _tag: "ValidationFailed",
        message: "idempotencyKey is required for externally visible writes.",
      },
    };
  }
  const ref = adapter.refs[operation.operationId];
  if (ref === undefined) {
    return {
      ok: false,
      error: {
        _tag: "NotFound",
        message: `No generated ref registered for operation: ${operation.operationId}`,
      },
    };
  }
  const input =
    request.idempotencyKey === undefined
      ? request.input
      : { ...request.input, idempotencyKey: request.idempotencyKey };
  const result =
    operation.kind === "query"
      ? await adapter.runQuery(ref, input)
      : operation.kind === "mutation"
        ? await adapter.runMutation(ref, input)
        : await adapter.runAction(ref, input);
  if (!isJsonValue(result)) {
    return {
      ok: false,
      error: {
        _tag: "ValidationFailed",
        message: "Headless operation returned a non-JSON-safe value.",
      },
    };
  }
  return {
    ok: true,
    operationId: operation.operationId,
    result,
  };
};
```

This executor does not contain a fake success path. Tests may pass stub
adapters, but runtime API/CLI/MCP surfaces must provide real generated refs. The
`check:headless-surface-contract` gate added later must fail if production
runtime code returns canned `{ accepted: true }` responses.

- [ ] **Step 2: Add executor tests**

Create `packages/convex/test/headless-executor.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  executeHeadlessOperation,
  findHeadlessOperation,
} from "../confect/manifest/executor";

describe("headless executor", () => {
  const adapter = {
    refs: { "brain.pages.createMarkdown": { ref: "createMarkdown" } },
    runQuery: async () => ({ rows: [] }),
    runMutation: async (_ref: unknown, input: Record<string, unknown>) => ({
      created: true,
      input,
    }),
    runAction: async () => ({ accepted: true }),
  };

  it("denies operations not exposed on the requested surface", () => {
    expect(findHeadlessOperation("brain.pages.list", "api")).toBeUndefined();
  });

  it("requires idempotency for external writes", async () => {
    await expect(
      executeHeadlessOperation(adapter, {
        operationId: "brain.pages.createMarkdown",
        surface: "api",
        input: {},
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: { _tag: "ValidationFailed" },
    });
  });

  it("dispatches exposed writes through the provided generated ref adapter", async () => {
    await expect(
      executeHeadlessOperation(adapter, {
        operationId: "brain.pages.createMarkdown",
        surface: "api",
        input: { slug: "note" },
        idempotencyKey: "key_1",
      }),
    ).resolves.toMatchObject({
      ok: true,
      operationId: "brain.pages.createMarkdown",
    });
  });
});
```

- [ ] **Step 3: Run focused tests**

Run:

```bash
rtk pnpm --dir packages/convex test headless-executor.test.ts
rtk pnpm --dir packages/convex typecheck
```

Expected: both commands exit `0`.

- [ ] **Step 4: Commit**

Run:

```bash
rtk git add packages/convex/confect/manifest/executor.ts packages/convex/test/headless-executor.test.ts && rtk git commit -m "feat: add generated headless executor seam"
```

## Task 18: Replace Canned HTTP Projection With Generated Manifest Projection

**Files:**

- Modify: `packages/convex/confect/http.ts`
- Modify: `packages/convex/test/http-docs.test.ts`
- Modify: `tooling/workflow/src/index.ts`
- Modify: `apps/cli/src/index.ts`
- Modify: `apps/cli/src/index.test.ts`

- [ ] **Step 1: Update Convex HTTP handler**

In `packages/convex/confect/http.ts`, remove imports from
`@maestro-template/workflow-tooling` and import:

```ts
import { confectManifest } from "@maestro-template/template-core/generated/confectManifest";
import { executeHeadlessOperation } from "./manifest/executor";
import { api } from "../convex/_generated/api";
```

Build `templateHttpRoutes` from
`confectManifest.functions.filter((entry) => entry.surfaces.includes("api"))`.

Change the request dispatcher so the Convex HTTP action context is threaded into
API execution:

```ts
type HeadlessHttpCtx = {
  readonly runQuery: (
    ref: unknown,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly runMutation: (
    ref: unknown,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
  readonly runAction: (
    ref: unknown,
    input: Record<string, unknown>,
  ) => Promise<unknown>;
};

export const handleTemplateHttpRequest = async (
  ctx: HeadlessHttpCtx,
  request: Request,
): Promise<Response> => {
  // existing docs/openapi routing plus manifest dispatch
};
```

Then update the deployable router so it passes the context instead of ignoring
it:

```ts
const handler = httpActionGeneric(async (ctx, request) =>
  handleTemplateHttpRequest(ctx, request),
);
```

For API `POST` dispatch, call:

```ts
const operationRefs = {
  "brain.pages.createMarkdown": api.brain.pages.createMarkdown,
} satisfies Record<string, unknown>;

return jsonResponse(
  await executeHeadlessOperation(
    {
      refs: operationRefs,
      runQuery: (ref, input) => ctx.runQuery(ref as never, input as never),
      runMutation: (ref, input) =>
        ctx.runMutation(ref as never, input as never),
      runAction: (ref, input) => ctx.runAction(ref as never, input as never),
    },
    {
      operationId: apiEntry.operationId,
      surface: "api",
      input: body.input ?? {},
      idempotencyKey: body.idempotencyKey,
    },
  ),
);
```

The mapping is intentionally explicit in this task. Task 21's parity gate must
fail when a manifest operation exposed to API/CLI/MCP lacks a generated ref
mapping. Do not substitute a fake handler for missing refs. Update HTTP tests
that call `handleTemplateHttpRequest` directly to pass a stub `HeadlessHttpCtx`;
docs routes may use no-op runners, while API dispatch tests must assert the
appropriate runner was called.

- [ ] **Step 2: Keep the old tooling package as a compatibility wrapper**

In `tooling/workflow/src/index.ts`, replace `templateRegistry`-derived
`buildApiCatalog`, `buildHeadlessOperations`, `buildMcpTools`, and
`buildOpenApiDocument` with wrappers over `confectManifest`.

The new `buildHeadlessOperations()` maps each manifest function and surface to:

```ts
{
  id: `${surface}:${entry.operationId}`,
  surface,
  capability: entry.operationId,
  route: surface === "api" ? `/api/${entry.operationId}` : entry.operationId,
  authScope: "workspace member",
  typedErrors: entry.typedErrors,
}
```

- [ ] **Step 3: Update CLI command output expectations**

In `apps/cli/src/index.test.ts`, update operation counts and operation ids to
match `confectManifest`. Assert that `operations list` includes
`api:brain.pages.createMarkdown` and does not include canned operations absent
from the manifest.

- [ ] **Step 4: Run focused tests**

Run:

```bash
rtk pnpm --dir packages/convex test http-docs.test.ts headless-executor.test.ts
rtk pnpm --dir tooling/workflow test
rtk pnpm --dir apps/cli test
rtk host-test-slot --class focused pnpm typecheck
```

Expected: all commands exit `0`.

- [ ] **Step 5: Commit**

Run:

```bash
rtk git add packages/convex/confect/http.ts packages/convex/test/http-docs.test.ts tooling/workflow/src/index.ts apps/cli/src/index.ts apps/cli/src/index.test.ts && rtk git commit -m "feat: project headless surfaces from manifest"
```

## Task 19: Generate OpenAPI And MCP From Effect Schemas

**Files:**

- Create: `packages/convex/confect/manifest/openapi.ts`
- Create: `packages/convex/confect/manifest/mcp.ts`
- Modify: `packages/convex/confect/http.ts`
- Modify: `tooling/workflow/src/index.ts`
- Modify: `packages/convex/test/http-docs.test.ts`

- [ ] **Step 1: Add OpenAPI builder**

Create `packages/convex/confect/manifest/openapi.ts`:

```ts
import { confectManifest } from "@maestro-template/template-core/generated/confectManifest";

type JsonSchema = {
  readonly type?: string;
  readonly properties?: Record<string, JsonSchema>;
  readonly required?: readonly string[];
  readonly enum?: readonly string[];
  readonly additionalProperties?: boolean;
};

const objectSchema: JsonSchema = {
  type: "object",
  additionalProperties: true,
};

export const buildGeneratedOpenApiDocument = () => ({
  openapi: "3.1.0" as const,
  info: {
    title: "Maestro Template Headless API",
    version: "0.1.0",
    description: "Generated from Confect contract manifest metadata.",
  },
  paths: Object.fromEntries(
    confectManifest.functions
      .filter((entry) => entry.surfaces.includes("api"))
      .map((entry) => [
        `/api/${entry.operationId}`,
        {
          post: {
            operationId: entry.operationId,
            tags: ["template-headless"],
            "x-maestro-typed-errors": entry.typedErrors,
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: objectSchema,
                },
              },
            },
            responses: {
              "200": { description: "Typed operation result." },
              "400": { description: "Declared typed failure." },
            },
          },
        },
      ]),
  ),
});
```

Task 31 upgrades this from object fallback schemas to `effect/JSONSchema`
output. The object fallback exists only until the schema handles added by Tasks
14-16 are converted into generated JSON Schema objects.

- [ ] **Step 2: Add MCP builder**

Create `packages/convex/confect/manifest/mcp.ts`:

```ts
import { confectManifest } from "@maestro-template/template-core/generated/confectManifest";

export const buildGeneratedMcpTools = () =>
  confectManifest.functions
    .filter((entry) => entry.surfaces.includes("mcp"))
    .map((entry) => ({
      name: `template.${entry.operationId}`,
      description: `Invoke ${entry.operationId} through the generated Confect contract manifest.`,
      inputSchema: {
        type: "object",
        additionalProperties: true,
      },
      typedErrors: entry.typedErrors,
    }));
```

- [ ] **Step 3: Wire HTTP and workflow wrappers**

In `packages/convex/confect/http.ts`, serve `buildGeneratedOpenApiDocument()` at
`/api/openapi.json`.

In `tooling/workflow/src/index.ts`, export
`buildOpenApiDocument = buildGeneratedOpenApiDocument` and
`buildMcpTools = buildGeneratedMcpTools`, or duplicate a browser-safe projection
if server imports would cross package boundaries.

- [ ] **Step 4: Run focused tests**

Run:

```bash
rtk pnpm --dir packages/convex test http-docs.test.ts
rtk pnpm --dir tooling/workflow test
rtk pnpm --dir apps/cli test
rtk host-test-slot --class focused pnpm typecheck
```

Expected: all commands exit `0`.

- [ ] **Step 5: Commit**

Run:

```bash
rtk git add packages/convex/confect/manifest packages/convex/confect/http.ts packages/convex/test/http-docs.test.ts tooling/workflow/src/index.ts apps/cli/src/index.ts apps/cli/src/index.test.ts && rtk git commit -m "feat: generate API and MCP metadata"
```

## Task 20: Upgrade Confect Contract Gates From Pin-Only To Semantic

**Files:**

- Modify: `tooling/quality/check-confect-contracts.mts`
- Modify: `tooling/quality/check-confect-contracts.test.mts`
- Modify: `tooling/quality/src/check-definitions.mts`
- Modify: `docs/rule-coverage.md`

- [ ] **Step 1: Keep descriptor checks but add semantic checks**

Replace `tooling/quality/check-confect-contracts.mts` with a runner that first
calls the existing descriptor and then checks files. The runner must:

- fail if any `packages/convex/confect/**/*.spec.ts` imports a non-type
  `convex/*` function value for plain Convex component functions;
- fail if a public `FunctionSpec.publicQuery`, `FunctionSpec.publicMutation`,
  `FunctionSpec.publicAction`, or public node-action constructor lacks `error:`;
- fail if `packages/convex/confect/_generated/refs.ts` or `_generated/spec.ts`
  is missing;
- fail if `packages/template-core/src/generated/confectManifest.ts` is missing;
- fail if `Date.now()` appears in `packages/convex/confect/**/*.impl.ts`.

- [ ] **Step 2: Add tests for pass/fail fixtures**

Update `tooling/quality/check-confect-contracts.test.mts` to create temporary
fixture strings and call exported pure functions from
`check-confect-contracts.mts`. Include at least:

```ts
it("rejects public specs without declared typed errors", () => {
  expect(
    publicSpecMissingError(
      "const run = FunctionSpec.publicMutation({ name: 'run' });",
    ),
  ).toContain("typed error");
  expect(
    publicSpecMissingError(
      "const run = FunctionSpec.publicAction({ name: 'run' });",
    ),
  ).toContain("typed error");
});
```

and:

```ts
it("rejects ambient time in impls", () => {
  expect(ambientDateNow("const now = Date.now();")).toContain("Date.now");
});
```

- [ ] **Step 3: Update rule coverage**

Change the `Use Confect/Effect contracts` enforcement row from pin-only to
mechanical in `docs/rule-coverage.md`, naming `check:confect-contracts` as
semantic.

- [ ] **Step 4: Run gate tests**

Run:

```bash
rtk pnpm --dir tooling/quality test check-confect-contracts
rtk host-test-slot --class focused pnpm check:confect-contracts
```

Expected: both commands exit `0`.

- [ ] **Step 5: Commit**

Run:

```bash
rtk git add tooling/quality/check-confect-contracts.mts tooling/quality/check-confect-contracts.test.mts tooling/quality/src/check-definitions.mts docs/rule-coverage.md && rtk git commit -m "feat: enforce semantic Confect contracts"
```

## Task 21: Upgrade Headless Surface Gate To Prove Generated Parity

**Files:**

- Modify: `tooling/quality/check-headless-surface-contract.mts`
- Modify: `tooling/quality/check-headless-surface-contract.test.mts`
- Modify: `tooling/quality/src/check-definitions.mts`
- Modify: `docs/rule-coverage.md`

- [ ] **Step 1: Add generated parity checks**

The gate must fail when:

- an operation exposed to `api`, `cli`, or `mcp` lacks public typed errors;
- a mutation/action exposed to `api`, `cli`, or `mcp` is marked
  `idempotent: false` and docs/tests do not assert idempotency-key enforcement;
- an operation exposed to `api`, `cli`, or `mcp` lacks a generated ref mapping
  in `packages/convex/confect/http.ts`, `apps/cli/src/index.ts`, or the MCP
  projection;
- runtime executor code outside tests returns canned success markers such as
  `{ accepted: true }` instead of calling `executeHeadlessOperation` with
  generated refs;
- `tooling/workflow/src/index.ts` imports `templateRegistry`;
- `packages/convex/confect/http.ts` imports
  `@maestro-template/workflow-tooling`;
- `apps/cli/src/index.ts` imports `templateRegistry`.

- [ ] **Step 2: Add tests**

In `tooling/quality/check-headless-surface-contract.test.mts`, add pure-function
tests for:

```ts
expect(
  missingTypedErrors([
    { operationId: "x", surfaces: ["api"], typedErrors: [] },
  ]),
).toContain("x");
expect(
  cannedRegistryImport(
    'import { templateRegistry } from "@maestro-template/template-core";',
  ),
).toContain("templateRegistry");
expect(
  cannedRuntimeSuccess("return { ok: true, result: { accepted: true } };"),
).toContain("accepted");
expect(
  missingGeneratedRefMapping(["brain.pages.createMarkdown"], "{}"),
).toContain("brain.pages.createMarkdown");
```

- [ ] **Step 3: Run gate tests**

Run:

```bash
rtk pnpm --dir tooling/quality test check-headless-surface-contract
rtk host-test-slot --class focused pnpm check:headless-surface-contract
```

Expected: both commands exit `0`.

- [ ] **Step 4: Commit**

Run:

```bash
rtk git add tooling/quality/check-headless-surface-contract.mts tooling/quality/check-headless-surface-contract.test.mts tooling/quality/src/check-definitions.mts docs/rule-coverage.md && rtk git commit -m "feat: enforce generated headless surfaces"
```

## Task 22: Fix Capability Generator Layout And Error Imports

**Files:**

- Modify: `tooling/generators/src/index.ts`
- Modify: `tooling/generators/src/index.test.ts`
- Modify: `docs/template/how-to-add-capability.md`
- Modify: `docs/template/generator-output-contract.md`

- [ ] **Step 1: Change draft capability output layout**

In `buildCapabilityFiles`, change `basePath` from:

```ts
const basePath = `generated/capabilities/${name}`;
```

to:

```ts
const basePath = `packages/convex/confect/capabilities/${name}`;
```

Emit these files:

- `${basePath}.spec.ts`
- `${basePath}.impl.ts`
- `${basePath}.domain.ts`
- `${basePath}.test.ts`
- `${basePath}.headless.json`
- `docs/template/generated/capabilities/${name}.md`

The plan intentionally uses flat `capabilities/<name>.spec.ts` files, matching
existing `sourceGroundedBrief.spec.ts`.

- [ ] **Step 2: Import shared typed errors**

Replace generated inline `Schema.TaggedStruct(...)` error definitions with:

```ts
import { Forbidden, Unauthorized, ValidationFailed } from "../errors";
```

and:

```ts
error: () => Schema.Union(Unauthorized, ValidationFailed, Forbidden),
```

Use the correct relative import for flat files: `../errors` from
`packages/convex/confect/capabilities/<name>.spec.ts`.

- [ ] **Step 3: Update promotion layout**

In `buildCapabilityPromotionFiles`, change `basePath` from:

```ts
const basePath = `packages/convex/confect/capabilities/${name}/${name}`;
```

to:

```ts
const basePath = `packages/convex/confect/capabilities/${name}`;
```

Then change each emitted file path from nested `${basePath}/${name}.spec.ts` to
flat `${basePath}.spec.ts`; repeat for `.impl.ts`, `.headless.json`, and docs.

- [ ] **Step 4: Update generator tests**

In `tooling/generators/src/index.test.ts`, update expected paths:

```ts
"packages/convex/confect/capabilities/summarizeSource.spec.ts";
"packages/convex/confect/capabilities/summarizeSource.impl.ts";
"packages/convex/confect/capabilities/summarizeSource.domain.ts";
"packages/convex/confect/capabilities/summarizeSource.test.ts";
"packages/convex/confect/capabilities/summarizeSource.headless.json";
```

Remove expected `generated/capabilities/...` paths from capability tests.

- [ ] **Step 5: Run generator tests**

Run:

```bash
rtk pnpm --dir tooling/generators test
rtk host-test-slot --class focused pnpm check:generators
```

Expected: both commands exit `0`. If `check:generators` fails only because
Convex codegen needs a live deployment connection, record the exact failure in
`docs/template/effectification-status.md`, run the focused generator tests and
non-live generated-file checks, and do not claim the full generator gate passed.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add tooling/generators/src/index.ts tooling/generators/src/index.test.ts docs/template/how-to-add-capability.md docs/template/generator-output-contract.md && rtk git commit -m "feat: generate flat Confect capabilities"
```

## Task 22A: Preserve And Effectify The Existing Workflow Spine

**Files:**

- Modify: `packages/convex/confect/workflows/graph.ts`
- Modify: `packages/convex/confect/tables/workflowRuns.ts`
- Modify: `packages/convex/confect/tables/workflowStageRuns.ts`
- Create: `packages/convex/confect/tables/workflowRunLinks.ts`
- Create: `packages/convex/confect/workflows/_kit/status.ts`
- Create: `packages/convex/confect/workflows/_kit/ownership.ts`
- Create: `packages/convex/confect/workflows/_kit/observedStage.ts`
- Create: `packages/convex/confect/workflows/_kit/graphRunner.ts`
- Create: `packages/convex/test/workflow-spine-effect.test.ts`
- Modify: `docs/template/workflow-authoring-guide.md`

- [ ] **Step 0: Write the workflow runner semantics mini-spec**

Before editing runtime code, add this section to
`docs/template/workflow-authoring-guide.md`:

```md
## Durable Graph Runner Semantics

The persisted `DurableWorkflowGraph` is the source of truth. React Flow and
other editors are projections over this graph, never the persisted source.

Runtime context:

- The graph runner receives `inputs`, `policySnapshot`, and a generated
  capability registry.
- Each node result is stored under `context[node.id]`.
- Capability node args are `{ inputs, context, node, policySnapshot }` unless a
  later schema task declares a narrower generated args schema.
- Source nodes copy `inputs` into `context[node.id]`.
- Output nodes project `{ inputs, context, policySnapshot }` into a
  Convex-serializable object. The first output node reached becomes the final
  result; if no output node is reached, the full context is returned.
- Agent nodes may only dispatch generated internal capability refs tagged as
  agent seats. They do not call provider adapters or repos directly.

Graph traversal:

- Nodes become ready when all incoming edges without false conditions have
  satisfied source nodes.
- Join nodes must wait for every required incoming source.
- Edges with conditions use the safe expression grammar below; false edges do
  not activate their target.
- Delay nodes call `step.sleep(delayMs)` and return `{ delayedMs }`.
- Approval nodes call `step.awaitEvent({ name })`, where name is
  `${graph.id}.${node.id}.approved`, and return the event payload.
- Capability nodes resolve `node.capability` through the generated capability
  registry and call only `step.runAction`, `step.runMutation`, or
  `step.runQuery`.

Condition grammar:

- Allowed identifiers: `inputs`, `context`, `policySnapshot`.
- Allowed operators: `===`, `!==`, `&&`, `||`, `!`, parentheses, string and
  number literals.
- No function calls, property writes, constructor access, global identifiers,
  regex literals, or dynamic imports.
- Invalid conditions fail validation before workflow start.

Failures:

- Missing capability refs fail as typed workflow validation errors before
  dispatch.
- Unsupported node kinds fail as typed workflow validation errors.
- Stage observability failures are quarantined; the original workflow failure or
  result is preserved.
- All outputs must be Convex JSON-safe.
```

Run the Task 0 workflow proof before implementing this task. If
`@convex-dev/workflow@0.4.4` exposes different step APIs than this mini-spec,
update this section and the signatures below before writing code. The current
template guard only accepts `result.<path> == literal` style conditions. This
task must replace that guard with the mini-spec grammar above and add tests for
allowed and rejected expressions before graph execution uses conditions.

- [ ] **Step 1: Extend durable workflow graph nodes for replay-safe delays**

In `packages/convex/confect/workflows/graph.ts`, add `delay` to the node kind
schema and add an optional `delayMs` field to workflow nodes:

```ts
export const WorkflowNodeKind = S.Literal(
  "source",
  "capability",
  "agent",
  "approval",
  "delay",
  "output",
);

export const WorkflowNode = S.Struct({
  id: S.String,
  kind: WorkflowNodeKind,
  label: S.String,
  capability: S.optional(S.String),
  agent: S.optional(S.String),
  delayMs: S.optional(S.Number),
  retry: WorkflowRetryConfig,
});
```

Inside the existing `WorkflowGraphValidationError` namespace, add an
`InvalidDelayConfig` class and include it in the namespace `Schema` union:

```ts
export class InvalidDelayConfig extends S.TaggedError<InvalidDelayConfig>()(
  "InvalidDelayConfig",
  {
    nodeId: S.String,
    field: S.Literal("delayMs"),
  },
) {}

export const Schema = S.Union(
  MissingStartNode,
  DuplicateNodeId,
  DanglingEdge,
  InvalidRetryConfig,
  InvalidDelayConfig,
  InvalidJoin,
  InvalidConditionExpression,
);
```

Extend `validateWorkflowGraph` so delay nodes must declare a positive integer
delay:

```ts
if (
  node.kind === "delay" &&
  (node.delayMs === undefined ||
    !Number.isInteger(node.delayMs) ||
    node.delayMs <= 0)
) {
  errors.push(
    new WorkflowGraphValidationError.InvalidDelayConfig({
      nodeId: node.id,
      field: "delayMs",
    }),
  );
}
```

Keep condition logic on edges. Do not add arbitrary executable condition nodes
in this task.

- [ ] **Step 2: Expand durable workflow run rows without deleting current
      fields**

Keep the current graph/run/audit columns and add component-workflow ownership
columns. In `packages/convex/confect/tables/workflowRuns.ts`, replace the row
schema with:

```ts
import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export const WorkflowRunStatus = Schema.Literal(
  "queued",
  "running",
  "completed",
  "failed",
  "canceled",
  "timedOut",
);

export const WorkflowRunRow = Schema.Struct({
  workspaceId: Schema.String,
  workflowId: Schema.String,
  workflowVersion: Schema.Number,
  graphJson: Schema.String,
  status: WorkflowRunStatus,
  idempotencyKey: Schema.String,
  startedByUserId: Schema.String,
  startedAt: Schema.Number,
  completedAt: Schema.NullOr(Schema.Number),
  failedAt: Schema.NullOr(Schema.Number),
  trustReceiptId: Schema.NullOr(Schema.String),
  componentWorkflowId: Schema.optional(Schema.String),
  workflowKind: Schema.optional(Schema.String),
  sourceRunKind: Schema.optional(Schema.String),
  sourceRunId: Schema.optional(Schema.String),
  timeoutMs: Schema.optional(Schema.Number),
  deadlineAt: Schema.optional(Schema.Number),
  timedOutAt: Schema.optional(Schema.NullOr(Schema.Number)),
  timeoutErrorCode: Schema.optional(Schema.NullOr(Schema.String)),
  timeoutSummary: Schema.optional(Schema.NullOr(Schema.String)),
});

export default Table.make(() => WorkflowRunRow)
  .index("by_workspace_status", ["workspaceId", "status"])
  .index("by_workflow_version", ["workflowId", "workflowVersion"])
  .index("by_idempotency_key", ["workspaceId", "idempotencyKey"])
  .index("by_component_workflow", ["componentWorkflowId"])
  .index("by_workspace_component_workflow", [
    "workspaceId",
    "componentWorkflowId",
  ]);
```

In `packages/convex/confect/tables/workflowStageRuns.ts`, keep the existing
columns, add the `delay` kind, accept both the current `completed` status and
the Maestro-derived `succeeded` status during migration, and add the
ownership/attempt names so stage rows can represent both template fake-first
runs and component-backed runs. Preserve the existing `attempt` field; write
both `attempt` and `attemptNumber` for new component-backed rows until a later
schema-migration task removes the compatibility field.

```ts
kind: Schema.Literal("source", "capability", "agent", "approval", "delay", "output"),
status: Schema.Literal(
  "queued",
  "running",
  "completed",
  "succeeded",
  "failed",
  "skipped",
  "canceled",
),
componentWorkflowId: Schema.optional(Schema.String),
stageKey: Schema.optional(Schema.String),
attempt: Schema.Number,
attemptNumber: Schema.optional(Schema.Number),
order: Schema.optional(Schema.Number),
summary: Schema.optional(Schema.NullOr(Schema.String)),
```

New timeout and summary fields are optional during the transition so existing
rows do not need an immediate backfill. If a later schema migration makes them
required, it must include a migration/backfill and remove the optionality in the
same commit.

Add indexes:

```ts
.index("by_component_workflow_order", ["componentWorkflowId", "order"])
.index("by_component_workflow_stage_attempt", [
  "componentWorkflowId",
  "stageKey",
  "attemptNumber",
])
```

- [ ] **Step 3: Add parent-child workflow links**

Create `packages/convex/confect/tables/workflowRunLinks.ts`:

```ts
import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export default Table.make(() =>
  Schema.Struct({
    workspaceId: Schema.String,
    parentWorkflowId: Schema.String,
    childWorkflowId: Schema.NullOr(Schema.String),
    parentKind: Schema.String,
    childKind: Schema.String,
    relationKind: Schema.String,
    relationId: Schema.String,
    idempotencyKey: Schema.String,
    status: Schema.Literal(
      "starting",
      "running",
      "succeeded",
      "failed",
      "canceled",
    ),
    childResultJson: Schema.NullOr(Schema.String),
    createdAt: Schema.Number,
    updatedAt: Schema.Number,
  }),
)
  .index("by_workspace_and_parent", ["workspaceId", "parentWorkflowId"])
  .index("by_workspace_and_child", ["workspaceId", "childWorkflowId"])
  .index("by_workspace_and_idempotency", ["workspaceId", "idempotencyKey"]);
```

- [ ] **Step 4: Add typed component status projection**

Create `packages/convex/confect/workflows/_kit/status.ts`:

```ts
import * as Schema from "effect/Schema";

export const WorkflowStatusResult = Schema.Struct({
  type: Schema.Literal(
    "inProgress",
    "completed",
    "failed",
    "canceled",
    "timedOut",
  ),
  error: Schema.NullOr(Schema.String),
  errorCode: Schema.optional(Schema.String),
});

export type WorkflowStatusResult = Schema.Schema.Type<
  typeof WorkflowStatusResult
>;

type TimeoutProjection = {
  readonly timedOutAt?: number | null;
  readonly timeoutErrorCode?: string | null;
  readonly timeoutSummary?: string | null;
};

export const projectWorkflowStatus = (
  value: unknown,
  run?: TimeoutProjection | null,
): WorkflowStatusResult => {
  if (run?.timedOutAt !== undefined && run.timedOutAt !== null) {
    return {
      type: "timedOut",
      error: typeof run.timeoutSummary === "string" ? run.timeoutSummary : null,
      ...(typeof run.timeoutErrorCode === "string"
        ? { errorCode: run.timeoutErrorCode }
        : {}),
    };
  }

  if (typeof value !== "object" || value === null || !("type" in value)) {
    return { type: "inProgress", error: null };
  }

  const status = value as { readonly type?: unknown; readonly error?: unknown };
  if (status.type === "completed") return { type: "completed", error: null };
  if (status.type === "failed") {
    return {
      type: "failed",
      error: typeof status.error === "string" ? status.error : null,
    };
  }
  if (status.type === "canceled") return { type: "canceled", error: null };
  return { type: "inProgress", error: null };
};
```

- [ ] **Step 5: Add a Confect/Effect ownership helper around plain Convex
      workflow starts**

Create `packages/convex/confect/workflows/_kit/ownership.ts`. The helper starts
a plain `convex/workflows/*.ts` `defineWorkflow` function and records workspace
ownership. The workflow replay handler itself remains plain Convex code, because
`@convex-dev/workflow` registers through Convex function references.

```ts
import { start, type WorkflowId } from "@convex-dev/workflow";
import type { FunctionArgs, FunctionReference } from "convex/server";
import * as Effect from "effect/Effect";
import {
  DatabaseReader,
  DatabaseWriter,
  MutationCtx,
} from "../../_generated/services";

export type StartWorkflowOwnershipInput<
  F extends FunctionReference<"mutation", "internal">,
> = {
  readonly workflowRef: F;
  readonly args: FunctionArgs<F>["args"];
  readonly workspaceId: string;
  readonly workflowId: string;
  readonly workflowVersion: number;
  readonly graphJson: string;
  readonly idempotencyKey: string;
  readonly startedByUserId: string;
  readonly now: number;
  readonly workflowKind?: string;
  readonly timeoutMs?: number;
};

export const startWorkflowAndRecordOwnership = <
  F extends FunctionReference<"mutation", "internal">,
>(
  input: StartWorkflowOwnershipInput<F>,
): Effect.Effect<
  WorkflowId,
  Error,
  MutationCtx | DatabaseReader | DatabaseWriter
> =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    const reader = yield* DatabaseReader;
    const writer = yield* DatabaseWriter;

    const existing = yield* reader
      .table("workflowRuns")
      .index("by_idempotency_key", (q) =>
        q
          .eq("workspaceId", input.workspaceId)
          .eq("idempotencyKey", input.idempotencyKey),
      )
      .unique()
      .pipe(Effect.orDie);
    if (existing?.componentWorkflowId !== undefined) {
      return existing.componentWorkflowId as WorkflowId;
    }
    if (existing !== null) {
      return yield* Effect.fail(
        new Error(
          `Workflow start already reserved for idempotency key: ${input.idempotencyKey}`,
        ),
      );
    }

    const reservationId = yield* writer
      .table("workflowRuns")
      .insert({
        workspaceId: input.workspaceId,
        workflowId: input.workflowId,
        workflowVersion: input.workflowVersion,
        graphJson: input.graphJson,
        status: "queued",
        idempotencyKey: input.idempotencyKey,
        startedByUserId: input.startedByUserId,
        startedAt: input.now,
        completedAt: null,
        failedAt: null,
        trustReceiptId: null,
        ...(input.workflowKind === undefined
          ? {}
          : { workflowKind: input.workflowKind }),
        ...(input.timeoutMs === undefined
          ? {}
          : { timeoutMs: input.timeoutMs }),
        deadlineAt:
          input.timeoutMs === undefined
            ? undefined
            : input.now + input.timeoutMs,
        timedOutAt: null,
        timeoutErrorCode: null,
        timeoutSummary: null,
      })
      .pipe(Effect.orDie);

    const componentWorkflowId = yield* Effect.tryPromise({
      try: () =>
        start(ctx, input.workflowRef, input.args, { startAsync: true }),
      catch: (error) =>
        error instanceof Error ? error : new Error(String(error)),
    });

    yield* writer
      .table("workflowRuns")
      .patch(reservationId, {
        status: "running",
        componentWorkflowId,
      })
      .pipe(Effect.orDie);

    return componentWorkflowId;
  });
```

The reservation row is written before `start(...)`, and the workflow is started
with `{ startAsync: true }`, so replay cannot observe a component workflow id
before the app-owned ownership row exists. The idempotency check is still
application-level; if the table/index model later supports uniqueness, add the
unique constraint in the same task.

- [ ] **Step 6: Add the Promise-shaped observed-stage helper for workflow
      handlers**

Create `packages/convex/confect/workflows/_kit/observedStage.ts`. This file
intentionally uses the `@convex-dev/workflow` Promise-shaped `step` API; Effect
stays inside Confect capability implementations that the step invokes.

```ts
export type WorkflowStepForObservedStage = {
  readonly workflowId: string;
  readonly runMutation: (
    ref: unknown,
    args: Readonly<Record<string, unknown>>,
  ) => Promise<unknown>;
};

export type ObservedWorkflowStage = {
  readonly workspaceId: string;
  readonly startRef: unknown;
  readonly finishRef: unknown;
  readonly stageKey: string;
  readonly order: number;
  readonly label: string;
};

type StageStartResult = { readonly _id: string };

export const runObservedWorkflowStage = async <Result>(
  step: WorkflowStepForObservedStage,
  stage: ObservedWorkflowStage,
  runStage: () => Promise<Result>,
): Promise<Result> => {
  let stageRun: StageStartResult | null = null;
  try {
    stageRun = (await step.runMutation(stage.startRef, {
      workspaceId: stage.workspaceId,
      workflowId: step.workflowId,
      stageKey: stage.stageKey,
      order: stage.order,
      label: stage.label,
    })) as StageStartResult;
  } catch {
    stageRun = null;
  }

  try {
    const result = await runStage();
    if (stageRun !== null) {
      try {
        await step.runMutation(stage.finishRef, {
          workspaceId: stage.workspaceId,
          stageRunId: stageRun._id,
          status: "succeeded",
        });
      } catch {
        // Stage observability is best-effort; preserve the business result.
      }
    }
    return result;
  } catch (caught) {
    if (stageRun !== null) {
      try {
        await step.runMutation(stage.finishRef, {
          workspaceId: stage.workspaceId,
          stageRunId: stageRun._id,
          status: "failed",
          errorCode: "WORKFLOW_STAGE_FAILED",
          summary: caught instanceof Error ? caught.message : String(caught),
        });
      } catch {
        // Stage observability is best-effort; preserve the business failure.
      }
    }
    throw caught;
  }
};
```

- [ ] **Step 7: Port the generic graph runner without replacing the graph
      model**

Create `packages/convex/confect/workflows/_kit/graphRunner.ts` by porting the
ideas from
`/Users/headless/maestro/packages/convex/convex/adapters/workflowGraphRunner.ts`
onto the existing `DurableWorkflowGraph` schema. It must:

- call only capability refs from the generated capability registry;
- topologically walk the graph rather than running only `startNodeId`;
- replace the current narrow `isSafeConditionExpression` guard with the
  mini-spec grammar from Step 0, then evaluate only expressions accepted by that
  guard;
- support `source`, `capability`, `agent`, `approval`, `delay`, and `output`
  nodes as typed branches, with unsupported node kinds failing through a public
  typed error;
- wrap each executed node in `runObservedWorkflowStage` when observability refs
  are provided;
- return Convex-serializable JSON.

The public function signature is:

```ts
import type { FunctionArgs, FunctionReference } from "convex/server";
import type { DurableWorkflowGraph } from "../graph";

export type DurableGraphStepRef =
  | FunctionReference<"action", "public" | "internal">
  | FunctionReference<"mutation", "public" | "internal">
  | FunctionReference<"query", "public" | "internal">;

export type DurableGraphCapabilityEnvelope = {
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly context: Readonly<Record<string, unknown>>;
  readonly node: DurableWorkflowGraph["nodes"][number];
  readonly policySnapshot: Readonly<Record<string, unknown>>;
};

export type DurableGraphCapabilityEntry<
  F extends DurableGraphStepRef = DurableGraphStepRef,
> = {
  readonly kind: "action" | "mutation" | "query";
  readonly ref: F;
  readonly buildArgs?: (envelope: DurableGraphCapabilityEnvelope) => FunctionArgs<F>;
  readonly retry?: unknown;
};

export type RunDurableGraphInput = {
  readonly graph: DurableWorkflowGraph;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly policySnapshot: Readonly<Record<string, unknown>>;
  readonly capabilityRegistry: Readonly<Record<string, DurableGraphCapabilityEntry>>;
  readonly observability?: {
    readonly workspaceId: string;
    readonly startStageRef: unknown;
    readonly finishStageRef: unknown;
  };
};

export type RunDurableGraphStep = {
  readonly workflowId: string;
  readonly runAction: (ref: DurableGraphStepRef, args: unknown, options?: unknown) => Promise<unknown>;
  readonly runMutation: (ref: DurableGraphStepRef, args: unknown) => Promise<unknown>;
  readonly runQuery: (ref: DurableGraphStepRef, args: unknown) => Promise<unknown>;
  readonly awaitEvent: (event: { readonly name: string; readonly validator?: unknown }) => Promise<unknown>;
  readonly sleep: (durationMs: number) => Promise<void>;
};

export const runDurableGraphWorkflow = (
  step: RunDurableGraphStep,
  input: RunDurableGraphInput,
): Promise<Readonly<Record<string, unknown>>>;
```

The implementation must be complete in this task. It should use the existing
`validateWorkflowGraph` result before dispatch, start from `graph.startNodeId`,
walk reachable nodes in dependency order, resolve `node.capability` through
`input.capabilityRegistry`, build step args with `entry.buildArgs(envelope)`
when present and otherwise use the generic envelope, call
`step.runAction`/`runMutation`/`runQuery` by entry kind, call
`step.sleep(node.delayMs)` for delay nodes, call `step.awaitEvent({ name })` for
approval nodes where `name` is `${input.graph.id}.${node.id}.approved`, store
each node result in a context object keyed by node id, evaluate safe condition
edges before activating downstream nodes, and return the final context. It must
implement the mini-spec from Step 0: source nodes, output nodes,
agent/capability separation, join readiness, condition grammar, delay, approval,
typed missing-ref failures, and JSON-safe result projection. Do not copy Maestro
product capability names; only copy the portable graph-runner shape.

Every generated workflow capability registry entry must provide a `buildArgs`
mapper when the concrete Convex ref does not accept the generic envelope. For
example, `sourceGroundedBrief.runInternal` must not be called with
`{ inputs, context, node, policySnapshot }` unless its own schema explicitly
accepts that envelope; the generated mapper must project the concrete
`workspaceId`, source fields, idempotency key, and other args the capability
declares.

- [ ] **Step 8: Add focused tests for the preserved workflow spine**

Create `packages/convex/test/workflow-spine-effect.test.ts` with tests that
prove:

```ts
import { describe, expect, it } from "vitest";
import { projectWorkflowStatus } from "../confect/workflows/_kit/status";

describe("effectified workflow spine", () => {
  it("projects component workflow status without trusting malformed blobs", () => {
    expect(projectWorkflowStatus({ type: "completed" })).toEqual({
      type: "completed",
      error: null,
    });
    expect(
      projectWorkflowStatus({ type: "failed", error: "provider down" }),
    ).toEqual({
      type: "failed",
      error: "provider down",
    });
    expect(projectWorkflowStatus({ type: "unknown" })).toEqual({
      type: "inProgress",
      error: null,
    });
  });

  it("lets local timeout rows override component status", () => {
    expect(
      projectWorkflowStatus(
        { type: "inProgress" },
        {
          timedOutAt: 1,
          timeoutErrorCode: "WORKFLOW_TIMED_OUT",
          timeoutSummary: "Workflow exceeded its deadline.",
        },
      ),
    ).toEqual({
      type: "timedOut",
      error: "Workflow exceeded its deadline.",
      errorCode: "WORKFLOW_TIMED_OUT",
    });
  });
});
```

Add graph-runner tests by copying the template's current `workflow-run.test.ts`
shape and upgrading the graph to include two capability nodes, one delay node,
one approval node, one condition edge, and one output node. The expected result
must prove both capability refs were dispatched through the capability registry,
the delay node called `step.sleep`, the approval node called `step.awaitEvent`,
and each executed node emitted a stage start/finish pair.

- [ ] **Step 9: Document the workflow stack decision**

In `docs/template/workflow-authoring-guide.md`, add this rule:

```md
## Durable Runtime Boundary

Workflow replay handlers live in `packages/convex/convex/workflows/*.ts` and use
`defineWorkflow(components.workflow, ...)`. Confect owns start, status, event,
cancel, restart, cleanup, manifest, and capability step contracts. Do not move
replay handlers into Confect impl files: the workflow component is the durable
runtime, while Confect is the typed contract layer around it.
```

- [ ] **Step 10: Run focused workflow checks**

Run:

```bash
rtk pnpm confect:codegen
rtk pnpm --dir packages/convex test workflow
rtk pnpm --dir tooling/quality test check-workflow-graph-boundary
rtk host-test-slot --class focused pnpm check:workflow-graph-boundary
rtk host-test-slot --class focused pnpm check:confect-v9
```

Expected: every command exits `0`, and the generated Confect/Convex schema
changes are only the table and workflow ref changes introduced by this task.

- [ ] **Step 11: Commit**

Run:

```bash
rtk git add packages/convex/confect/workflows/graph.ts packages/convex/confect/tables/workflowRuns.ts packages/convex/confect/tables/workflowStageRuns.ts packages/convex/confect/tables/workflowRunLinks.ts packages/convex/confect/workflows/_kit packages/convex/test/workflow-spine-effect.test.ts docs/template/workflow-authoring-guide.md packages/convex/confect/_generated packages/convex/convex/_generated packages/convex/convex/schema.ts && rtk git commit -m "feat: preserve workflow spine under Confect contracts"
```

## Task 23: Upgrade Workflow Generator To Emit Durable Workflow Contracts

**Files:**

- Modify: `tooling/generators/src/index.ts`
- Modify: `tooling/generators/src/index.test.ts`
- Modify: `docs/template/how-to-add-workflow.md`

- [ ] **Step 1: Add workflow spec output**

In `buildWorkflowFiles`, keep the durable graph JSON and add the files that
connect a workflow to both the Convex workflow runtime and the Confect contract
layer:

- `packages/convex/confect/workflows/${name}.spec.ts`
- `packages/convex/confect/workflows/${name}.impl.ts`
- `packages/convex/confect/workflows/${name}.graph.ts`
- `packages/convex/convex/workflows/${name}.ts`
- `packages/convex/test/${name}.workflow.test.ts`
- `docs/template/generated/workflows/${name}.md`

Generated Confect spec content:

```ts
import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";
import {
  collectContractManifest,
  collectContractSchemas,
  defineContractFunction,
} from "../capabilities/_kit/capability";
import {
  MemberNotInWorkspace,
  NotFound,
  Unauthorized,
  ValidationFailed,
  WorkspaceNotFound,
} from "../errors";
import { Id } from "../_generated/id";
import { WorkflowStatusResult } from "./_kit/status";

const WorkflowErrors = Schema.Union(
  Unauthorized,
  MemberNotInWorkspace,
  WorkspaceNotFound,
  NotFound,
  ValidationFailed,
);

export const StartArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  idempotencyKey: Schema.String,
});

export const StartReturns = Schema.Struct({
  status: Schema.Literal("queued"),
  workflow: Schema.Literal("${name}"),
  componentWorkflowId: Schema.String,
});

export const StatusArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  componentWorkflowId: Schema.String,
});

export const ApproveArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  componentWorkflowId: Schema.String,
  nodeId: Schema.String,
});

export const ApproveReturns = Schema.Struct({
  eventId: Schema.String,
});

const start = defineContractFunction(
  FunctionSpec.publicMutation({
    name: "start",
    args: () => StartArgs,
    returns: () => StartReturns,
    error: () => WorkflowErrors,
  }),
  {
    namespace: "workflows.${name}",
    name: "start",
    operationId: "workflows.${name}.start",
    kind: "mutation",
    surfaces: ["web", "api", "cli", "mcp"],
    typedErrors: [
      "Unauthorized",
      "MemberNotInWorkspace",
      "WorkspaceNotFound",
      "NotFound",
      "ValidationFailed",
    ],
    idempotent: false,
    argsSchemaName: "workflows.${name}.start.args",
    returnsSchemaName: "workflows.${name}.start.returns",
    argsSchema: StartArgs,
    returnsSchema: StartReturns,
  },
);

const status = defineContractFunction(
  FunctionSpec.publicQuery({
    name: "status",
    args: () => StatusArgs,
    returns: () => WorkflowStatusResult,
    error: () => WorkflowErrors,
  }),
  {
    namespace: "workflows.${name}",
    name: "status",
    operationId: "workflows.${name}.status",
    kind: "query",
    surfaces: ["web", "api", "cli", "mcp"],
    typedErrors: [
      "Unauthorized",
      "MemberNotInWorkspace",
      "WorkspaceNotFound",
      "NotFound",
      "ValidationFailed",
    ],
    idempotent: true,
    argsSchemaName: "workflows.${name}.status.args",
    returnsSchemaName: "workflows.${name}.status.returns",
    argsSchema: StatusArgs,
    returnsSchema: WorkflowStatusResult,
  },
);

const approve = defineContractFunction(
  FunctionSpec.publicMutation({
    name: "approve",
    args: () => ApproveArgs,
    returns: () => ApproveReturns,
    error: () => WorkflowErrors,
  }),
  {
    namespace: "workflows.${name}",
    name: "approve",
    operationId: "workflows.${name}.approve",
    kind: "mutation",
    surfaces: ["web", "api", "cli", "mcp"],
    typedErrors: [
      "Unauthorized",
      "MemberNotInWorkspace",
      "WorkspaceNotFound",
      "NotFound",
      "ValidationFailed",
    ],
    idempotent: false,
    argsSchemaName: "workflows.${name}.approve.args",
    returnsSchemaName: "workflows.${name}.approve.returns",
    argsSchema: ApproveArgs,
    returnsSchema: ApproveReturns,
  },
);

const contractFunctions = [start, status, approve] as const;
export const manifest = collectContractManifest(contractFunctions);
export const schemaRegistry = collectContractSchemas(contractFunctions);

export default GroupSpec.make()
  .addFunction(start.spec)
  .addFunction(status.spec)
  .addFunction(approve.spec);
```

- [ ] **Step 2: Add durable graph output**

Generated `packages/convex/confect/workflows/${name}.graph.ts` content:

```ts
import type { DurableWorkflowGraph } from "./graph";

export const ${name}Graph = {
  id: "workflow_${name}",
  version: 1,
  startNodeId: "start",
  nodes: [
    {
      id: "start",
      kind: "source",
      label: "${name} start",
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: "receipt",
      kind: "output",
      label: "Trust Receipt",
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
  ],
  edges: [
    {
      id: "edge_start_receipt",
      sourceNodeId: "start",
      targetNodeId: "receipt",
    },
  ],
  joins: [],
} satisfies DurableWorkflowGraph;
```

- [ ] **Step 3: Add plain Convex workflow replay handler output**

Generated `packages/convex/convex/workflows/${name}.ts` content:

```ts
import { defineWorkflow } from "@convex-dev/workflow";
import { v } from "convex/values";
import { components } from "../_generated/api";
import {
  runDurableGraphWorkflow,
  type RunDurableGraphStep,
} from "../../confect/workflows/_kit/graphRunner";
import { ${name}Graph } from "../../confect/workflows/${name}.graph";

export const run = defineWorkflow(components.workflow, {
  args: {
    workspaceId: v.string(),
    idempotencyKey: v.string(),
  },
  returns: v.any(),
}).handler((step, args) =>
  runDurableGraphWorkflow(step as RunDurableGraphStep, {
    graph: ${name}Graph,
    inputs: args,
    policySnapshot: {},
    capabilityRegistry: {},
  }),
);
```

This file is plain Convex source by design. Do not emit it as a Confect impl.
The default generated graph is source/output only so it cannot accidentally call
a domain capability with the wrong arg shape. When the generator or a developer
adds a capability node, it must also emit a registry entry with a concrete
`buildArgs` mapper for that capability, for example:

```ts
capabilityRegistry: {
  sourceGroundedBrief: {
    kind: "mutation",
    ref: internal.capabilities.sourceGroundedBrief.runInternal,
    buildArgs: ({ inputs, context, node, policySnapshot }) =>
      buildSourceGroundedBriefWorkflowArgs({
        inputs,
        context,
        node,
        policySnapshot,
      }),
  },
}
```

The referenced `runInternal` capability is produced by the capability builder
for workflow-step use; if a capability has only public refs, add the internal
step ref and the arg mapper before adding it to a workflow graph.

- [ ] **Step 4: Add Confect start/status impl output**

Generated `packages/convex/confect/workflows/${name}.impl.ts` content:

```ts
import { getStatus, sendEvent, type WorkflowId } from "@convex-dev/workflow";
import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { components, internal } from "../../convex/_generated/api";
import databaseSchema from "../_generated/schema";
import { DatabaseReader, MutationCtx, QueryCtx } from "../_generated/services";
import { NotFound } from "../errors";
import { requireWorkspaceAccess } from "../capabilities/_kit/workspaceAccess";
import { startWorkflowAndRecordOwnership } from "./_kit/ownership";
import { projectWorkflowStatus } from "./_kit/status";
import { ${name}Graph } from "./${name}.graph";
import ${name}Group from "./${name}.spec";

const startImpl = FunctionImpl.make(
  databaseSchema,
  ${name}Group,
  "start",
  ({ workspaceId, idempotencyKey }) =>
    Effect.gen(function* () {
      const access = yield* requireWorkspaceAccess(workspaceId, "editor");
      const now = yield* Clock.currentTimeMillis;
      const componentWorkflowId = yield* startWorkflowAndRecordOwnership({
        workflowRef: internal.workflows.${name}.run,
        args: { workspaceId, idempotencyKey },
        workspaceId,
        workflowId: ${name}Graph.id,
        workflowVersion: ${name}Graph.version,
        graphJson: JSON.stringify(${name}Graph),
        idempotencyKey,
        startedByUserId: access.userId,
        now,
        workflowKind: "workflow.${name}",
      });
      return {
        status: "queued" as const,
        workflow: "${name}" as const,
        componentWorkflowId,
      };
    }),
);

const statusImpl = FunctionImpl.make(
  databaseSchema,
  ${name}Group,
  "status",
  ({ workspaceId, componentWorkflowId }) =>
    Effect.gen(function* () {
      yield* requireWorkspaceAccess(workspaceId, "viewer");
      const reader = yield* DatabaseReader;
      const run = yield* reader
        .table("workflowRuns")
        .index("by_workspace_component_workflow", (q) =>
          q.eq("workspaceId", workspaceId).eq("componentWorkflowId", componentWorkflowId),
        )
        .unique()
        .pipe(Effect.orDie);
      if (run === null) {
        return yield* Effect.fail(
          new NotFound({ resource: "workflowRuns", id: componentWorkflowId }),
        );
      }
      const ctx = yield* QueryCtx;
      const rawStatus = yield* Effect.tryPromise({
        try: () =>
          getStatus(ctx, components.workflow, componentWorkflowId as WorkflowId),
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      });
      return projectWorkflowStatus(rawStatus, run);
    }),
);

const approveImpl = FunctionImpl.make(
  databaseSchema,
  ${name}Group,
  "approve",
  ({ workspaceId, componentWorkflowId, nodeId }) =>
    Effect.gen(function* () {
      yield* requireWorkspaceAccess(workspaceId, "editor");
      const reader = yield* DatabaseReader;
      const run = yield* reader
        .table("workflowRuns")
        .index("by_workspace_component_workflow", (q) =>
          q.eq("workspaceId", workspaceId).eq("componentWorkflowId", componentWorkflowId),
        )
        .unique()
        .pipe(Effect.orDie);
      if (run === null) {
        return yield* Effect.fail(
          new NotFound({ resource: "workflowRuns", id: componentWorkflowId }),
        );
      }
      const ctx = yield* MutationCtx;
      const eventId = yield* Effect.tryPromise({
        try: () =>
          sendEvent(ctx, components.workflow, {
            workflowId: componentWorkflowId as WorkflowId,
            name: ${name}Graph.id + "." + nodeId + ".approved",
            value: null,
          }),
        catch: (error) =>
          error instanceof Error ? error : new Error(String(error)),
      });
      return { eventId };
    }),
);

export default GroupImpl.make(databaseSchema, ${name}Group).pipe(
  Layer.provide(startImpl),
  Layer.provide(statusImpl),
  Layer.provide(approveImpl),
  GroupImpl.finalize,
);
```

- [ ] **Step 5: Update tests and docs**

Update generator tests to assert the spec, impl, graph, plain Convex workflow,
test, and docs files are emitted for `template:add-workflow`; assert the spec
uses `defineContractFunction`, exports `manifest` and `schemaRegistry`, and
includes `argsSchemaName` / `returnsSchemaName` for `start`, `status`, and
`approve`.

Update `docs/template/how-to-add-workflow.md` to state:

```md
Generated workflows have two halves: `convex/workflows/<name>.ts` is the durable
replay handler and `confect/workflows/<name>.{spec,impl}.ts` is the typed
start/status/approval contract. React Flow remains a projection of durable graph
data.

Generated approval nodes are only usable through the generated
`workflows.<name>.approve` mutation, which checks workspace access before
calling `sendEvent`. Generated capability nodes are only usable when their
registry entries include a concrete `buildArgs` mapper for the target internal
capability ref.
```

- [ ] **Step 6: Run generator tests**

Run:

```bash
rtk pnpm --dir tooling/generators test
rtk host-test-slot --class focused pnpm check:generators
```

Expected: both commands exit `0`. If `check:generators` fails only because
Convex codegen needs a live deployment connection, record that in
`docs/template/effectification-status.md`, run the focused generator tests and
non-live generated-file checks, and do not claim the full generator gate passed.

- [ ] **Step 7: Commit**

Run:

```bash
rtk git add tooling/generators/src/index.ts tooling/generators/src/index.test.ts docs/template/how-to-add-workflow.md && rtk git commit -m "feat: generate workflow Confect contracts"
```

## Task 24: Add The Missing Agent Generator Command

**Files:**

- Modify: `package.json`
- Modify: `tooling/generators/src/index.ts`
- Modify: `tooling/generators/src/index.test.ts`
- Modify: `docs/template/how-to-add-agent.md`

- [ ] **Step 1: Add root scripts**

In root `package.json`, add both names so existing docs and shorter naming work:

```json
"template:add-agent": "tsx tooling/generators/src/index.ts add-agent",
"template:add-agent-seat": "tsx tooling/generators/src/index.ts add-agent-seat"
```

- [ ] **Step 2: Add generator command aliases**

In `tooling/generators/src/index.ts`, route `add-agent` and `add-agent-seat` to
the same function.

The generated files must include:

- `packages/convex/confect/agents/${name}.spec.ts`
- `packages/convex/confect/agents/${name}.impl.ts`
- `packages/convex/confect/agents/${name}.tools.ts`
- `packages/convex/test/${name}.agent.test.ts`
- `docs/template/generated/agents/${name}.md`
- manifest metadata with `surfaces: ["web"]` by default and no headless
  exposure.

- [ ] **Step 3: Update docs**

Change `docs/template/how-to-add-agent.md` command block to:

```bash
pnpm template:add-agent -- --name workflow_architect --write
```

Mention that `template:add-agent-seat` remains an alias for older task briefs.

- [ ] **Step 4: Run tests**

Run:

```bash
rtk pnpm --dir tooling/generators test
rtk host-test-slot --class focused pnpm check:generators
rtk host-test-slot --class focused pnpm check:docs-freshness
```

Expected: all commands exit `0`. If `check:generators` fails only because Convex
codegen needs a live deployment connection, record the exact failure in
`docs/template/effectification-status.md`, run the focused generator tests and
non-live generated-file checks, and do not claim the full generator gate passed.

- [ ] **Step 5: Commit**

Run:

```bash
rtk git add package.json tooling/generators/src/index.ts tooling/generators/src/index.test.ts docs/template/how-to-add-agent.md && rtk git commit -m "feat: add agent generator command"
```

## Task 25: Add Effect Config Service Boundary

**Files:**

- Create: `packages/convex/confect/shared/config.ts`
- Modify: `packages/convex/confect/shared/env.ts`
- Modify: `packages/convex/test/shared-env.test.ts`
- Modify: `docs/template/env-manifest.md`

- [ ] **Step 1: Add Effect Config service**

Create `packages/convex/confect/shared/config.ts`:

```ts
import * as Config from "effect/Config";
import * as ConfigProvider from "effect/ConfigProvider";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

export type RuntimeMode = "fake" | "test" | "live";
export type TemplateRuntimeConfigShape = {
  readonly runtimeMode: RuntimeMode;
  readonly publicBaseUrl: string;
};

export const RuntimeModeConfig = Config.literal(
  "fake",
  "test",
  "live",
)("TEMPLATE_RUNTIME_MODE").pipe(Config.withDefault("fake" as const));

export const PublicBaseUrlConfig = Config.string(
  "TEMPLATE_PUBLIC_BASE_URL",
).pipe(Config.withDefault("http://localhost:5173"));

export class TemplateRuntimeConfig extends Context.Tag("TemplateRuntimeConfig")<
  TemplateRuntimeConfig,
  TemplateRuntimeConfigShape
>() {}

export const TemplateRuntimeConfigLive = Layer.effect(
  TemplateRuntimeConfig,
  Effect.gen(function* () {
    return {
      runtimeMode: yield* RuntimeModeConfig,
      publicBaseUrl: yield* PublicBaseUrlConfig,
    };
  }),
);

export const loadTemplateRuntimeConfig = Effect.gen(function* () {
  return yield* TemplateRuntimeConfig;
});

export const runWithTemplateRuntimeConfig = <A, E, R>(
  effect: Effect.Effect<A, E, R | TemplateRuntimeConfig>,
  provider = ConfigProvider.fromMap(new Map()),
): Effect.Effect<A, E, R> =>
  effect.pipe(
    Effect.provide(TemplateRuntimeConfigLive),
    Effect.withConfigProvider(provider),
  );
```

- [ ] **Step 2: Make `shared/env.ts` a compatibility wrapper**

Keep the existing `EnvConfigError` public error if tests or docs reference it.
Re-export the new loader and runner:

```ts
export {
  loadTemplateRuntimeConfig,
  runWithTemplateRuntimeConfig,
  TemplateRuntimeConfigLive,
} from "./config";
```

Update any env direct reads to use `ConfigProvider` or `TemplateRuntimeConfig`.

- [ ] **Step 3: Update tests**

In `packages/convex/test/shared-env.test.ts`, use `ConfigProvider.fromMap` to
prove defaults and invalid literal failure:

```ts
import * as ConfigProvider from "effect/ConfigProvider";
import * as Effect from "effect/Effect";
import {
  loadTemplateRuntimeConfig,
  runWithTemplateRuntimeConfig,
} from "../confect/shared/config";

const provider = ConfigProvider.fromMap(
  new Map([["TEMPLATE_RUNTIME_MODE", "test"]]),
);
const result = await Effect.runPromise(
  runWithTemplateRuntimeConfig(loadTemplateRuntimeConfig, provider),
);
expect(result.runtimeMode).toBe("test");
```

This follows the `Effect.withConfigProvider` pattern from
`repos/effect/packages/effect/test/Config.test.ts`.

- [ ] **Step 4: Run tests**

Run:

```bash
rtk pnpm --dir packages/convex test shared-env.test.ts
rtk pnpm --dir packages/convex typecheck
```

Expected: both commands exit `0`.

- [ ] **Step 5: Commit**

Run:

```bash
rtk git add packages/convex/confect/shared/config.ts packages/convex/confect/shared/env.ts packages/convex/test/shared-env.test.ts docs/template/env-manifest.md && rtk git commit -m "feat: add Effect runtime config service"
```

## Task 25A: Add PostHog Error-Capture Middleware For Confect Effects

**Files:**

- Create: `packages/convex/confect/observability/errorCapture.ts`
- Create: `packages/convex/confect/observability/posthog.ts`
- Create: `packages/convex/test/observability-error-capture.test.ts`
- Create: `tooling/effectified-api-proof/posthog-proof.ts`
- Modify: `packages/convex/package.json`
- Modify: `tooling/effectified-api-proof/package.json`
- Modify: `packages/convex/convex/convex.config.ts`
- Modify: `pnpm-lock.yaml`
- Modify: `packages/observability/src/index.ts`
- Modify: `packages/observability/src/index.test.ts`
- Modify: `docs/template/integrations.md`
- Modify: `docs/template/env-manifest.md`
- Modify: `docs/template/confect-effect-guide.md`
- Modify: `docs/template/effectification-status.md`

- [ ] **Step 1: Add the PostHog Convex component dependency**

Run the package checkpoint:

```bash
rtk npm view @posthog/convex version
```

Expected: the command prints `2.0.32` or a newer compatible patch. If it prints
a newer patch, update the exact pin below and note the version in
`docs/template/integrations.md`.

Add this dependency to `packages/convex/package.json`. The production Maestro
example used `2.0.28`; the 2026-07-03 checkpoint found `2.0.32`, so use the
newer exact patch unless a fresh `npm view @posthog/convex version` check finds
a newer compatible patch:

```json
"@posthog/convex": "2.0.32"
```

Add the same exact dependency to `tooling/effectified-api-proof/package.json`.
Then create `tooling/effectified-api-proof/posthog-proof.ts`:

```ts
import { PostHog } from "@posthog/convex";

declare const component: ConstructorParameters<typeof PostHog>[0];
const posthog = new PostHog(component);

declare const ctx: Parameters<typeof posthog.capture>[0];
void posthog.capture(ctx, {
  distinctId: "proof",
  event: "template.proof",
  properties: { source: "effectified-api-proof" },
});
```

Run `rtk pnpm install` after editing the manifest so `pnpm-lock.yaml` records
the exact component version.

- [ ] **Step 2: Mount the PostHog Convex component**

In `packages/convex/convex/convex.config.ts`, add:

```ts
import posthog from "@posthog/convex/convex.config.js";
import { v } from "convex/values";
```

Change:

```ts
const app = defineApp();
```

to:

```ts
const app = defineApp({
  env: {
    POSTHOG_PROJECT_TOKEN: v.string(),
    POSTHOG_HOST: v.string(),
  },
});
```

Then mount the component before other app-specific runtime code:

```ts
app.use(posthog, {
  env: {
    POSTHOG_PROJECT_TOKEN: app.env.POSTHOG_PROJECT_TOKEN,
    POSTHOG_HOST: app.env.POSTHOG_HOST,
  },
});
```

If the current `@posthog/convex` API exposes optional env configuration, prefer
optional env and a no-op local/test capture adapter. If it requires strings,
document fake/test values in `docs/template/env-manifest.md` and ensure local
test setup supplies non-secret placeholders such as
`POSTHOG_PROJECT_TOKEN=phc_test_placeholder` and
`POSTHOG_HOST=http://localhost`. Never require live PostHog credentials for
fake/test posture.

- [ ] **Step 3: Extend the shared observability contract**

In `packages/observability/src/index.ts`, add:

```ts
export type CapturedFailureKind = "mutation" | "action";

export type CapturedConfectFailure = {
  readonly functionPath: string;
  readonly kind: CapturedFailureKind;
  readonly errorTag: string;
  readonly errorMessage: string;
  readonly causeHash: string;
  readonly workspaceId?: string;
  readonly userId?: string;
};

export const createConfectFailureEvent = (
  failure: CapturedConfectFailure,
): PostHogEvent => ({
  event: "template.confect.failure",
  distinctId: failure.userId ?? "system",
  properties: redactObservabilityPayload({
    functionPath: failure.functionPath,
    kind: failure.kind,
    errorTag: failure.errorTag,
    errorMessage: failure.errorMessage,
    causeHash: failure.causeHash,
    workspaceId: failure.workspaceId,
  }),
});
```

- [ ] **Step 4: Add observability contract tests**

In `packages/observability/src/index.test.ts`, add:

```ts
import { createConfectFailureEvent } from "./index";

it("builds redacted Confect failure events for PostHog", () => {
  expect(
    createConfectFailureEvent({
      functionPath: "brain/pages.createMarkdown",
      kind: "mutation",
      errorTag: "MemberNotInWorkspace",
      errorMessage: "Denied",
      causeHash: "cause_123",
      workspaceId: "workspaces_1",
      userId: "users_1",
    }),
  ).toEqual({
    event: "template.confect.failure",
    distinctId: "users_1",
    properties: {
      functionPath: "brain/pages.createMarkdown",
      kind: "mutation",
      errorTag: "MemberNotInWorkspace",
      errorMessage: "Denied",
      causeHash: "cause_123",
      workspaceId: "workspaces_1",
    },
  });
});
```

- [ ] **Step 5: Add a Convex/PostHog capture adapter**

Create `packages/convex/confect/observability/posthog.ts`:

```ts
import { PostHog } from "@posthog/convex";
import type { Scheduler } from "convex/server";
import * as Effect from "effect/Effect";
import {
  createConfectFailureEvent,
  type CapturedFailureKind,
} from "@maestro-template/observability";
import { components } from "../../convex/_generated/api";

export const posthog = new PostHog(components.posthog);

export type SchedulerCtx = {
  readonly scheduler: Scheduler;
};

export type CaptureFailureInput = {
  readonly functionPath: string;
  readonly kind: CapturedFailureKind;
  readonly errorTag: string;
  readonly errorMessage: string;
  readonly causeHash: string;
  readonly workspaceId?: string;
  readonly userId?: string;
};

export const captureFailure = (
  ctx: SchedulerCtx,
  input: CaptureFailureInput,
): Effect.Effect<void> =>
  Effect.tryPromise(async () => {
    await posthog.capture(ctx, createConfectFailureEvent(input));
  }).pipe(Effect.asVoid);
```

This adapter follows the production Maestro shape: credentials live on the
Convex component configured in `convex.config.ts`, and event delivery is
scheduled through `ctx.scheduler`. Convex query ctx does not expose a scheduler,
so backend PostHog capture middleware is mutation/action scoped. Query failures
should either remain uncaptured, be mirrored from the caller, or be recorded by
a separate durable event path in a future task. The adapter may fail if PostHog
scheduling fails; the middleware must catch that failure and re-fail the
original business cause.

- [ ] **Step 6: Add Effect cause conversion and middleware**

Create `packages/convex/confect/observability/errorCapture.ts`:

```ts
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { ActionCtx, MutationCtx } from "../_generated/services";
import { captureFailure, type CaptureFailureInput } from "./posthog";

export type CapturedError = {
  readonly tag: string;
  readonly message: string;
  readonly hash: string;
};

export const errorFromCause = <E>(cause: Cause.Cause<E>): CapturedError => {
  const rendered = String(cause);
  const failure = Cause.failureOption(cause);
  if (failure._tag === "Some") {
    const value = failure.value as {
      readonly _tag?: string;
      readonly message?: string;
    };
    return {
      tag: value._tag ?? "EffectFailure",
      message: value.message ?? "Effect failed.",
      hash: `cause_${Math.abs(hashString(rendered))}`,
    };
  }
  return {
    tag: "EffectDefect",
    message: "Effect failed with a defect.",
    hash: `cause_${Math.abs(hashString(rendered))}`,
  };
};

const hashString = (value: string): number => {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return hash;
};

export const withMutationErrorCapture = <A, E, R>(
  functionPath: string,
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | MutationCtx> =>
  Effect.gen(function* () {
    const ctx = yield* MutationCtx;
    return yield* effect.pipe(
      Effect.catchAllCause((cause) => {
        const error = errorFromCause(cause);
        const input: CaptureFailureInput = {
          functionPath,
          kind: "mutation",
          errorTag: error.tag,
          errorMessage: error.message,
          causeHash: error.hash,
        };
        return captureFailure(ctx, input).pipe(
          Effect.catchAll(() => Effect.void),
          Effect.zipRight(Effect.failCause(cause)),
        );
      }),
    );
  });
```

This preserves the original typed failure or defect. The capture effect is
best-effort; if PostHog capture fails, the original cause is re-failed
unchanged.

After `withMutationErrorCapture` typechecks, extract the shared catch/capture
logic into a private `captureAndRefailCause` helper that accepts `functionPath`,
`kind`, `scheduler`, and `cause`. Then expose `withMutationErrorCapture` and
`withActionErrorCapture` thin wrappers. Do not expose `withQueryErrorCapture`
unless a later task adds a scheduler-capable query failure sink. The wrappers
may land incrementally, but the shared helper must be reusable before this task
is complete. Do not leave observability hard-coded to
`brain/pages.createMarkdown`.

- [ ] **Step 7: Add middleware tests**

Create `packages/convex/test/observability-error-capture.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import * as Cause from "effect/Cause";
import * as Effect from "effect/Effect";
import { Forbidden } from "../confect/errors";
import { errorFromCause } from "../confect/observability/errorCapture";

describe("Confect observability error capture", () => {
  it("extracts tagged Effect failures without exposing raw cause text", () => {
    const captured = errorFromCause(
      Cause.fail(new Forbidden({ reason: "denied" })),
    );
    expect(captured.tag).toBe("Forbidden");
    expect(captured.message).toBe("denied");
    expect(captured.hash).toMatch(/^cause_/);
  });

  it("leaves the original Effect failure in the error channel", async () => {
    const exit = await Effect.runPromiseExit(
      Effect.fail(new Forbidden({ reason: "denied" })),
    );
    expect(String(exit)).toContain("Forbidden");
  });
});
```

- [ ] **Step 8: Wrap the first migrated mutation and document rollout**

In `packages/convex/confect/brain/pages.impl.ts`, wrap the create mutation body:

```ts
import { withMutationErrorCapture } from "../observability/errorCapture";
```

Then change the handler to:

```ts
({ workspaceId, slug, title, markdown }) =>
  withMutationErrorCapture(
    "brain/pages.createMarkdown",
    Effect.gen(function* () {
      yield* requireWorkspaceAccess(workspaceId, "editor");
      const updatedAt = yield* Clock.currentTimeMillis;
      const writer = yield* DatabaseWriter;
      return yield* writer
        .table("brainPages")
        .insert({
          workspaceId,
          slug,
          title,
          markdown,
          sourceKind: "markdown",
          updatedAt,
        })
        .pipe(Effect.orDie);
    }),
  );
```

Add a row to `docs/template/effectification-status.md` listing which Confect
groups are wrapped and which remain unwrapped. Later capability-builder tasks
should provide an opt-in wrapper or shared impl factory so future groups do not
forget capture.

- [ ] **Step 9: Document middleware usage**

In `docs/template/confect-effect-guide.md`, add:

```markdown
## Observability Middleware

Confect mutation and action impls may wrap effects with observability middleware
that observes failures without changing the original error channel. For
mutations, `withMutationErrorCapture(functionPath, effect)` reads `MutationCtx`;
for actions, `withActionErrorCapture(functionPath, effect)` reads `ActionCtx`.
Both wrappers convert the `Cause` into a redacted event, attempt PostHog capture
through the observability adapter, suppress capture failures, and then re-fail
the original cause. Business logic must still fail with typed public errors
declared by the spec. Query ctx has no scheduler, so query failure capture
requires a separate future durable sink and is not part of this middleware.
```

In `docs/template/integrations.md`, add a PostHog backend-event note that
captured failure events contain function path, function kind, public error tag,
redacted message, and a cause hash.

- [ ] **Step 10: Run focused tests**

Run:

```bash
rtk pnpm confect:codegen
rtk pnpm --dir packages/observability test
rtk pnpm --dir packages/convex test observability-error-capture.test.ts brain-pages.contract.test.ts
rtk pnpm --dir packages/convex typecheck
rtk pnpm --dir packages/convex check:convex
rtk pnpm --dir tooling/effectified-api-proof typecheck
rtk host-test-slot --class focused pnpm check:posthog-readiness
```

Expected: all commands exit `0`, and generated Convex refs include the mounted
PostHog component without manual edits.

- [ ] **Step 11: Commit**

Run:

```bash
rtk git add packages/observability packages/convex/confect/observability packages/convex/confect/brain/pages.impl.ts packages/convex/package.json packages/convex/convex/convex.config.ts packages/convex/confect/_generated packages/convex/convex/_generated packages/convex/convex/schema.ts tooling/effectified-api-proof pnpm-lock.yaml packages/convex/test/observability-error-capture.test.ts docs/template/integrations.md docs/template/env-manifest.md docs/template/confect-effect-guide.md docs/template/effectification-status.md && rtk git commit -m "feat: capture Confect failures to observability"
```

## Task 26: Tighten Frontend Confect State Adapter States

**Files:**

- Modify: `apps/web/src/adapters/confect-state.ts`
- Modify: `apps/web/src/adapters/confect-state.test.ts`
- Modify: `docs/template/frontend-architecture.md`

- [ ] **Step 1: Name the existing frontend state contract**

In `apps/web/src/adapters/confect-state.ts`, after `TemplateMutationState`, add:

```ts
export type TemplateDataStatus = TemplateDataState<unknown, unknown>["status"];
export type TemplateMutationStatus = TemplateMutationState<
  unknown,
  unknown
>["status"];

export const TEMPLATE_DATA_STATUSES = [
  "skipped",
  "loading",
  "empty",
  "ready",
  "typed_failure",
  "parse_failure",
  "transport_failure",
  "defect",
] as const satisfies readonly TemplateDataStatus[];

export const TEMPLATE_MUTATION_STATUSES = [
  "loading",
  "ready",
  "typed_failure",
  "parse_failure",
  "transport_failure",
  "defect",
] as const satisfies readonly TemplateMutationStatus[];

export type TemplateFailureState<E = unknown> =
  | TemplateTypedFailureState<E>
  | TemplateParseFailureState
  | TemplateTransportFailureState
  | TemplateDefectState;

export function isTemplateFailureState<E>(
  state: TemplateDataState<unknown, E> | TemplateMutationState<unknown, E>,
): state is TemplateFailureState<E> {
  return (
    state.status === "typed_failure" ||
    state.status === "parse_failure" ||
    state.status === "transport_failure" ||
    state.status === "defect"
  );
}
```

Keep the existing `normalizeConfectQuery`, `normalizeReactQueryResult`,
`classifyConfectMutationResult`, and `normalizeMutationError` functions. Do not
create a second frontend result adapter with different status names.

- [ ] **Step 2: Extend the existing adapter tests**

In `apps/web/src/adapters/confect-state.test.ts`, add imports:

```ts
import {
  isTemplateFailureState,
  TEMPLATE_DATA_STATUSES,
  TEMPLATE_MUTATION_STATUSES,
} from "./confect-state";
```

Then add this test:

```ts
it("exposes one canonical frontend state vocabulary", () => {
  expect(TEMPLATE_DATA_STATUSES).toEqual([
    "skipped",
    "loading",
    "empty",
    "ready",
    "typed_failure",
    "parse_failure",
    "transport_failure",
    "defect",
  ]);
  expect(TEMPLATE_MUTATION_STATUSES).toEqual([
    "loading",
    "ready",
    "typed_failure",
    "parse_failure",
    "transport_failure",
    "defect",
  ]);
  expect(
    isTemplateFailureState({
      status: "typed_failure",
      error: { _tag: "Unauthorized" },
    }),
  ).toBe(true);
  expect(
    isTemplateFailureState({
      status: "ready",
      mode: "read",
      data: { id: "ok" },
    }),
  ).toBe(false);
});
```

- [ ] **Step 3: Document usage**

In `docs/template/frontend-architecture.md`, add:

```md
## Frontend Data States

Feature components normalize Confect and Convex query/mutation results through
`apps/web/src/adapters/confect-state.ts`. The canonical statuses are `skipped`,
`loading`, `empty`, `ready`, `typed_failure`, `parse_failure`,
`transport_failure`, and `defect`. Components should render these states
directly or through feature presenters; they should not branch on raw Confect,
Convex, TanStack Query, or Effect internals.
```

- [ ] **Step 4: Run tests**

Run:

```bash
rtk pnpm --dir apps/web test src/adapters/confect-state.test.ts
rtk pnpm --dir apps/web typecheck
```

Expected: both commands exit `0`.

- [ ] **Step 5: Commit**

Run:

```bash
rtk git add apps/web/src/adapters/confect-state.ts apps/web/src/adapters/confect-state.test.ts docs/template/frontend-architecture.md && rtk git commit -m "feat: name frontend Confect state contract"
```

## Task 26A: Decide And Encode The Frontend Effect State Policy

**Files:**

- Create: `docs/template/frontend-effect-state.md`
- Create: `apps/web/src/adapters/effectBoundary.ts`
- Create: `apps/web/src/adapters/effectBoundary.test.ts`
- Modify: `docs/template/frontend-architecture.md`

- [ ] **Step 1: Write the frontend stack policy**

Create `docs/template/frontend-effect-state.md`:

```md
# Frontend Effect State Policy

The template uses Effect heavily on the backend because typed errors, dependency
injection, scoped resources, retries, interruption, and telemetry compound
across Confect/Convex functions. The frontend has different pressure:
reactivity, async UI state, hydration, optimistic updates, push updates, and
bundle size.

## Default Stack

- TanStack Router/Start is the current route and SSR shell.
- Convex/Confect live hooks are the default server-state path for Convex data.
- TanStack Query stays only for the current `@convex-dev/react-query` router
  integration, route prefetching, and legacy surfaces that already depend on
  `QueryClient`.
- Generic Confect or Effect effects must not be wrapped directly in `useQuery`
  as the default integration.
- Workflow status, stage rows, and Trust Receipts should subscribe through
  Convex/Confect live queries because Convex is already reactive.

## Why Not Generic Effect In TanStack Query

TanStack Query models failures as rejected promises. Effect models expected
failures in the typed error channel and defects separately. Throwing from
`Effect.runPromise` erases the typed error unless a custom adapter restores it.
Moving failures into `Either` makes TanStack Query treat a failed operation as a
successful cache value, disabling the normal retry/error/cache model. Query
composition and cancellation also become fragile because TanStack Query's
internal cancellation semantics are not an Effect API.

## Approved Patterns

- Use generated Confect React hooks or plain Convex hooks for server state.
- Use `apps/web/src/adapters/confect-state.ts` to normalize skipped, loading,
  empty, ready, typed_failure, transport_failure, parse_failure, and defect
  states.
- Use `apps/web/src/adapters/effectBoundary.ts` only for rare isolated frontend
  actions that already need an Effect program.
- For complex local-first, worker-backed, streaming, optimistic, or
  Effect-runtime-aware frontend state, introduce Effect Atom behind
  `apps/web/src/effect-atom/*` or `packages/frontend-effect/*`. Start from the
  checked versions `@effect-atom/atom-react@0.5.0` and
  `@effect-atom/atom@0.5.3`, then recheck npm metadata in the implementation
  branch before editing `package.json`.
- Do not make Effect the React framework. React remains the renderer.

## Bundle Rules

- Client code imports Effect submodules such as `effect/Effect`,
  `effect/Schema`, and `effect/Either`.
- Client code does not import from the `effect` barrel.
- Effect Atom is opt-in and must land with a bundle-size note before becoming a
  template default.
```

- [ ] **Step 2: Add the explicit frontend Effect boundary helper**

Create `apps/web/src/adapters/effectBoundary.ts`:

```ts
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import {
  normalizeMutationSuccess,
  type TemplateMutationState,
  type TemplateReadyMode,
} from "./confect-state";

export type FrontendEffectBoundaryResult<Value, TypedError> =
  TemplateMutationState<Value, TypedError>;

const abortedState = (): TemplateMutationState<never, never> => ({
  status: "transport_failure",
  error: new Error("Action aborted."),
  message: "Action aborted.",
});

export const runFrontendEffectBoundary = async <Value, TypedError>(
  effect: Effect.Effect<Value, TypedError, never>,
  options: {
    readonly signal?: AbortSignal;
    readonly mode?: TemplateReadyMode;
  } = {},
): Promise<FrontendEffectBoundaryResult<Value, TypedError>> => {
  if (options.signal?.aborted) return abortedState();

  try {
    const result = await Effect.runPromise(Effect.either(effect), {
      signal: options.signal,
    });
    if (options.signal?.aborted) return abortedState();
    if (Either.isLeft(result)) {
      return { status: "typed_failure", error: result.left };
    }
    return normalizeMutationSuccess(result.right, { mode: options.mode });
  } catch (error) {
    if (options.signal?.aborted) return abortedState();
    return {
      status: "defect",
      error,
      message: error instanceof Error ? error.message : String(error),
    };
  }
};
```

This helper intentionally returns the same canonical mutation state vocabulary
as `apps/web/src/adapters/confect-state.ts`. It is for isolated imperative
frontend actions, not server-state rendering; components should not branch on a
second private status set such as `success` or `aborted`.

- [ ] **Step 3: Add boundary tests**

Create `apps/web/src/adapters/effectBoundary.test.ts`:

```ts
import * as Effect from "effect/Effect";
import { describe, expect, it } from "vitest";
import { runFrontendEffectBoundary } from "./effectBoundary";

describe("frontend Effect boundary", () => {
  it("returns success values without throwing", async () => {
    await expect(runFrontendEffectBoundary(Effect.succeed(1))).resolves.toEqual(
      {
        status: "ready",
        mode: "read",
        data: 1,
        mutation: "success",
      },
    );
  });

  it("keeps expected failures typed", async () => {
    await expect(
      runFrontendEffectBoundary(Effect.fail({ _tag: "Denied" as const })),
    ).resolves.toEqual({
      status: "typed_failure",
      error: { _tag: "Denied" },
    });
  });

  it("maps defects separately from typed errors", async () => {
    await expect(
      runFrontendEffectBoundary(Effect.die(new Error("boom"))),
    ).resolves.toMatchObject({
      status: "defect",
      message: "boom",
    });
  });

  it("short-circuits an already aborted action", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      runFrontendEffectBoundary(Effect.succeed(1), {
        signal: controller.signal,
      }),
    ).resolves.toMatchObject({
      status: "transport_failure",
      message: "Action aborted.",
    });
  });
});
```

- [ ] **Step 4: Link the policy from frontend architecture docs**

In `docs/template/frontend-architecture.md`, add:

```md
## Effect State Policy

The detailed frontend Effect policy lives in
`docs/template/frontend-effect-state.md`. In short: TanStack Router/Start is the
current routing shell, Convex/Confect hooks are the default server-state model,
TanStack Query remains only for current router/Convex integration and legacy
cache surfaces, and Effect Atom is an opt-in adapter for complex local client
state rather than the template default.
```

- [ ] **Step 5: Run focused frontend tests**

Run:

```bash
rtk pnpm --dir apps/web test src/adapters/effectBoundary.test.ts
rtk pnpm --dir apps/web typecheck
```

Expected: both commands exit `0`.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add docs/template/frontend-effect-state.md docs/template/frontend-architecture.md apps/web/src/adapters/effectBoundary.ts apps/web/src/adapters/effectBoundary.test.ts && rtk git commit -m "docs: define frontend Effect state policy"
```

## Task 26B: Add A Frontend Effect Boundary Gate

**Files:**

- Create: `tooling/quality/check-frontend-effect-boundary.mts`
- Create: `tooling/quality/check-frontend-effect-boundary.test.mts`
- Modify: `package.json`
- Modify: `docs/rule-coverage.md`

- [ ] **Step 1: Add the static gate**

Create `tooling/quality/check-frontend-effect-boundary.mts`:

```ts
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const repoRoot = process.cwd();
const scannedRoots = [
  "apps/web/src",
  "packages/editor-react/src",
  "packages/workflow-ui/src",
];
const approvedRunPromiseFiles = new Set([
  "apps/web/src/adapters/effectBoundary.ts",
]);
const approvedEffectAtomPrefixes = [
  "apps/web/src/effect-atom/",
  "packages/frontend-effect/",
];

type Finding = {
  readonly file: string;
  readonly message: string;
};

const walk = async (directory: string): Promise<readonly string[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return walk(fullPath);
      if (!/\.(ts|tsx|mts|cts)$/.test(entry.name)) return [];
      return [fullPath];
    }),
  );
  return files.flat();
};

const relative = (file: string): string =>
  path.relative(repoRoot, file).replace(/\\/g, "/");

const checkFile = async (file: string): Promise<readonly Finding[]> => {
  const rel = relative(file);
  const source = await readFile(file, "utf8");
  const findings: Finding[] = [];

  if (
    source.includes("Effect.runPromise") &&
    !approvedRunPromiseFiles.has(rel)
  ) {
    findings.push({
      file: rel,
      message:
        "Effect.runPromise is only allowed in apps/web/src/adapters/effectBoundary.ts.",
    });
  }

  if (/from\s+["']effect["']/.test(source)) {
    findings.push({
      file: rel,
      message:
        "Client code must import Effect submodules, not the effect barrel.",
    });
  }

  if (
    /from\s+["']@effect-atom\//.test(source) &&
    !approvedEffectAtomPrefixes.some((prefix) => rel.startsWith(prefix))
  ) {
    findings.push({
      file: rel,
      message:
        "Effect Atom imports must live behind the approved frontend-effect adapter boundary.",
    });
  }

  return findings;
};

const files = (
  await Promise.all(
    scannedRoots
      .map((root) => path.join(repoRoot, root))
      .filter((root) => existsSync(root))
      .map(walk),
  )
).flat();
const findings = (await Promise.all(files.map(checkFile))).flat();

if (findings.length > 0) {
  for (const finding of findings) {
    console.error(`${finding.file}: ${finding.message}`);
  }
  process.exit(1);
}

console.log("check:frontend-effect-boundary passed");
```

- [ ] **Step 2: Add gate tests**

Create `tooling/quality/check-frontend-effect-boundary.test.mts` with
fixture-style tests around the scanner behavior. Use the same helper style as
other `tooling/quality/*.test.mts` files. The tests must prove:

- `Effect.runPromise` in `apps/web/src/components/Bad.tsx` fails;
- `Effect.runPromise` in `apps/web/src/adapters/effectBoundary.ts` passes;
- `import { Effect } from "effect"` in client code fails;
- `import * as Effect from "effect/Effect"` in client code passes;
- `@effect-atom/atom-react` outside `apps/web/src/effect-atom/` fails.

- [ ] **Step 3: Add the root script**

In root `package.json`, add:

```json
"check:frontend-effect-boundary": "tsx tooling/quality/check-frontend-effect-boundary.mts"
```

Add it to `verify` after `check:route-tree` and before broad quality gates.

- [ ] **Step 4: Update rule coverage**

In `docs/rule-coverage.md`, add `check:frontend-effect-boundary` as a semantic
frontend architecture gate that enforces the approved Effect/TanStack/Effect
Atom boundary.

- [ ] **Step 5: Run the gate**

Run:

```bash
rtk pnpm --dir tooling/quality test check-frontend-effect-boundary
rtk host-test-slot --class focused pnpm check:frontend-effect-boundary
```

Expected: both commands exit `0`.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add tooling/quality/check-frontend-effect-boundary.mts tooling/quality/check-frontend-effect-boundary.test.mts package.json docs/rule-coverage.md && rtk git commit -m "feat: gate frontend Effect boundaries"
```

## Task 26C: Extract The Reusable Workflow Canvas State Primitive

**Files:**

- Create: `packages/workflow-ui/src/workflowCanvasState.ts`
- Modify: `packages/workflow-ui/src/index.tsx`
- Modify: `packages/workflow-ui/src/index.test.tsx`
- Create: `apps/web/src/features/workflows/workflowCanvasAdapter.ts`
- Create: `apps/web/src/features/workflows/workflowCanvasAdapter.test.ts`
- Modify: `docs/template/frontend-architecture.md`
- Modify: `docs/template/workflow-authoring-guide.md`

- [ ] **Step 1: Move workflow graph derivation into a pure state module**

Create `packages/workflow-ui/src/workflowCanvasState.ts`:

```ts
export type WorkflowNodeKind =
  "source" | "capability" | "agent" | "approval" | "delay" | "output";

export type DurableWorkflowGraphForCanvas = {
  readonly id: string;
  readonly version: number;
  readonly startNodeId: string;
  readonly nodes: readonly {
    readonly id: string;
    readonly label: string;
    readonly kind: WorkflowNodeKind;
    readonly capability?: string;
    readonly agent?: string;
    readonly delayMs?: number;
    readonly retry: {
      readonly maxAttempts: number;
      readonly backoffMs: number;
    };
  }[];
  readonly edges: readonly {
    readonly id: string;
    readonly sourceNodeId: string;
    readonly targetNodeId: string;
    readonly condition?: {
      readonly expression: string;
    };
  }[];
  readonly joins: readonly {
    readonly nodeId: string;
    readonly strategy: "all-successful" | "any-successful";
    readonly sourceNodeIds: readonly string[];
  }[];
};

export type WorkflowValidationHint = {
  readonly target: "node" | "edge";
  readonly id: string;
  readonly severity: "warning" | "error";
  readonly message: string;
};

export type WorkflowFlowValidationHint = Omit<
  WorkflowValidationHint,
  "target" | "id"
>;

export type WorkflowNodeStatus = "pending" | "running" | "completed" | "failed";

export type WorkflowFlowNodeData = {
  readonly label: string;
  readonly kind: WorkflowNodeKind;
  readonly capability?: string;
  readonly agent?: string;
  readonly delayMs?: number;
  readonly status?: WorkflowNodeStatus;
  readonly runSummary?: string;
  readonly runErrorCode?: string;
  readonly validationHints: readonly WorkflowFlowValidationHint[];
};

export type WorkflowFlowEdgeData = {
  readonly validationHints: readonly WorkflowFlowValidationHint[];
};

export type WorkflowFlowNode = {
  readonly id: string;
  readonly position: { readonly x: number; readonly y: number };
  readonly data: WorkflowFlowNodeData;
  readonly type: "default";
};

export type WorkflowFlowEdge = {
  readonly id: string;
  readonly source: string;
  readonly target: string;
  readonly label: string | undefined;
  readonly animated: boolean;
  readonly data: WorkflowFlowEdgeData;
};

export type WorkflowFlowModel = {
  readonly nodes: readonly WorkflowFlowNode[];
  readonly edges: readonly WorkflowFlowEdge[];
};

export type WorkflowCanvasView =
  | { readonly status: "loading" }
  | { readonly status: "empty" }
  | {
      readonly status: "ready";
      readonly model: WorkflowFlowModel;
    };

export type WorkflowStageStatus =
  | "queued"
  | "running"
  | "completed"
  | "succeeded"
  | "failed"
  | "skipped"
  | "canceled";

export type WorkflowStageRunForCanvas = {
  readonly stageKey: string;
  readonly status: WorkflowStageStatus;
  readonly attemptNumber: number;
  readonly summary?: string | null;
  readonly errorCode?: string | null;
};

export type WorkflowStageKeyMap = Readonly<Record<string, string>>;

export type WorkflowNodeStatusOverlay = {
  readonly nodeId: string;
  readonly status: WorkflowNodeStatus;
  readonly summary?: string;
  readonly errorCode?: string;
};

const kindY: Record<WorkflowNodeKind, number> = {
  source: 80,
  capability: 20,
  agent: 80,
  approval: 20,
  delay: 80,
  output: 80,
};

const hintsFor = (
  hints: readonly WorkflowValidationHint[],
  target: WorkflowValidationHint["target"],
  id: string,
): readonly WorkflowFlowValidationHint[] =>
  hints
    .filter((hint) => hint.target === target && hint.id === id)
    .map(({ severity, message }) => ({ severity, message }));

export const deriveWorkflowFlowModel = (
  graph: DurableWorkflowGraphForCanvas,
  validationHints: readonly WorkflowValidationHint[] = [],
): WorkflowFlowModel => ({
  nodes: graph.nodes.map((node, index) => ({
    id: node.id,
    position: { x: index * 260, y: kindY[node.kind] },
    data: {
      label: `${node.kind}: ${node.label}`,
      kind: node.kind,
      ...(node.capability !== undefined ? { capability: node.capability } : {}),
      ...(node.agent !== undefined ? { agent: node.agent } : {}),
      ...(node.delayMs !== undefined ? { delayMs: node.delayMs } : {}),
      validationHints: hintsFor(validationHints, "node", node.id),
    },
    type: "default",
  })),
  edges: graph.edges.map((edge) => ({
    id: edge.id,
    source: edge.sourceNodeId,
    target: edge.targetNodeId,
    label: edge.condition?.expression,
    animated: edge.condition !== undefined,
    data: {
      validationHints: hintsFor(validationHints, "edge", edge.id),
    },
  })),
});

export const deriveWorkflowCanvasView = (
  graph: DurableWorkflowGraphForCanvas | undefined,
  validationHints: readonly WorkflowValidationHint[] = [],
): WorkflowCanvasView => {
  if (graph === undefined) return { status: "loading" };
  if (graph.nodes.length === 0) return { status: "empty" };
  return {
    status: "ready",
    model: deriveWorkflowFlowModel(graph, validationHints),
  };
};

export const summarizeWorkflowValidationHints = (
  model: WorkflowFlowModel,
): { readonly errors: number; readonly warnings: number } => {
  const hints = [
    ...model.nodes.flatMap((node) => node.data.validationHints),
    ...model.edges.flatMap((edge) => edge.data.validationHints),
  ];

  return {
    errors: hints.filter((hint) => hint.severity === "error").length,
    warnings: hints.filter((hint) => hint.severity === "warning").length,
  };
};

export const mapWorkflowStageStatus = (
  status: WorkflowStageStatus,
): WorkflowNodeStatus => {
  if (status === "succeeded" || status === "completed") return "completed";
  if (status === "failed" || status === "canceled") return "failed";
  if (status === "queued" || status === "skipped") return "pending";
  return status;
};

const latestStageAttempts = (
  stages: readonly WorkflowStageRunForCanvas[],
): Map<string, WorkflowStageRunForCanvas> => {
  const latest = new Map<string, WorkflowStageRunForCanvas>();
  for (const stage of stages) {
    const previous = latest.get(stage.stageKey);
    if (
      previous === undefined ||
      stage.attemptNumber > previous.attemptNumber
    ) {
      latest.set(stage.stageKey, stage);
    }
  }
  return latest;
};

export const mapStageRunsToOverlay = (
  stages: readonly WorkflowStageRunForCanvas[],
  mapping: WorkflowStageKeyMap,
  nodeIds: readonly string[],
): readonly WorkflowNodeStatusOverlay[] => {
  const latest = latestStageAttempts(stages);
  const mappedNodeIds = new Set(Object.values(mapping));
  const overlays: WorkflowNodeStatusOverlay[] = [];

  for (const nodeId of nodeIds) {
    const stageKey = Object.entries(mapping).find(
      ([, mappedNodeId]) => mappedNodeId === nodeId,
    )?.[0];
    if (stageKey === undefined || !mappedNodeIds.has(nodeId)) continue;

    const stage = latest.get(stageKey);
    if (stage === undefined) {
      overlays.push({ nodeId, status: "pending" });
      continue;
    }

    overlays.push({
      nodeId,
      status: mapWorkflowStageStatus(stage.status),
      ...(stage.summary === null || stage.summary === undefined
        ? {}
        : { summary: stage.summary }),
      ...(stage.errorCode === null || stage.errorCode === undefined
        ? {}
        : { errorCode: stage.errorCode }),
    });
  }

  return overlays;
};

export const applyStatusOverlay = (
  model: WorkflowFlowModel,
  overlays: readonly WorkflowNodeStatusOverlay[],
): WorkflowFlowModel => {
  if (overlays.length === 0) return model;
  const byNodeId = new Map(
    overlays.map((overlay) => [overlay.nodeId, overlay]),
  );

  return {
    ...model,
    nodes: model.nodes.map((node) => {
      const overlay = byNodeId.get(node.id);
      if (overlay === undefined) return node;
      return {
        ...node,
        data: {
          ...node.data,
          status: overlay.status,
          ...(overlay.summary === undefined
            ? {}
            : { runSummary: overlay.summary }),
          ...(overlay.errorCode === undefined
            ? {}
            : { runErrorCode: overlay.errorCode }),
        },
      };
    }),
  };
};
```

- [ ] **Step 2: Make the React Flow renderer consume the pure model**

In `packages/workflow-ui/src/index.tsx`, import the pure state helpers:

```ts
import {
  deriveWorkflowFlowModel,
  type DurableWorkflowGraphForCanvas,
  type WorkflowValidationHint,
} from "./workflowCanvasState";
```

Export the pure model API from the package:

```ts
export {
  applyStatusOverlay,
  deriveWorkflowCanvasView,
  deriveWorkflowFlowModel,
  mapStageRunsToOverlay,
  mapWorkflowStageStatus,
  summarizeWorkflowValidationHints,
  type DurableWorkflowGraphForCanvas,
  type WorkflowCanvasView,
  type WorkflowFlowEdge,
  type WorkflowFlowModel,
  type WorkflowFlowNode,
  type WorkflowNodeStatus,
  type WorkflowNodeStatusOverlay,
  type WorkflowStageKeyMap,
  type WorkflowStageRunForCanvas,
  type WorkflowValidationHint,
} from "./workflowCanvasState";
```

Delete the duplicated local type and derivation definitions from `index.tsx`.
Keep `WorkflowCanvas` for the simple static demo and keep `WorkflowGraphCanvas`
as the React Flow renderer:

```tsx
export function WorkflowGraphCanvas({
  graph,
  validationHints = [],
}: {
  readonly graph: DurableWorkflowGraphForCanvas;
  readonly validationHints?: readonly WorkflowValidationHint[];
}) {
  const model = deriveWorkflowFlowModel(graph, validationHints);
  const flowNodes: Node[] = model.nodes.map((node) => ({ ...node }));
  const flowEdges: Edge[] = model.edges.map((edge) => ({ ...edge }));

  return (
    <div className="workflow-canvas" aria-label="Workflow graph template">
      <ReactFlow fitView nodes={flowNodes} edges={flowEdges}>
        <Background />
        <MiniMap pannable zoomable />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
```

- [ ] **Step 3: Add pure workflow canvas tests**

Replace `packages/workflow-ui/src/index.test.tsx` with tests for the extracted
state module:

```ts
import { describe, expect, it } from "vitest";
import {
  applyStatusOverlay,
  deriveWorkflowCanvasView,
  deriveWorkflowFlowModel,
  mapStageRunsToOverlay,
  summarizeWorkflowValidationHints,
  type DurableWorkflowGraphForCanvas,
} from "./workflowCanvasState";

const graph: DurableWorkflowGraphForCanvas = {
  id: "workflow_source_grounded_plan",
  version: 1,
  startNodeId: "source",
  nodes: [
    {
      id: "source",
      label: "Source Set",
      kind: "source",
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: "brief",
      label: "Source-grounded brief",
      kind: "capability",
      capability: "sourceGroundedBrief",
      retry: { maxAttempts: 2, backoffMs: 250 },
    },
  ],
  edges: [
    {
      id: "source-to-brief",
      sourceNodeId: "source",
      targetNodeId: "brief",
      condition: { expression: "result.status == 'ready'" },
    },
  ],
  joins: [],
};

describe("workflow canvas state", () => {
  it("derives loading, empty, and ready canvas views", () => {
    expect(deriveWorkflowCanvasView(undefined)).toEqual({ status: "loading" });
    expect(deriveWorkflowCanvasView({ ...graph, nodes: [] })).toEqual({
      status: "empty",
    });
    expect(deriveWorkflowCanvasView(graph)).toMatchObject({
      status: "ready",
      model: {
        nodes: [{ id: "source" }, { id: "brief" }],
        edges: [{ id: "source-to-brief", animated: true }],
      },
    });
  });

  it("keeps validation hints as overlays instead of graph data", () => {
    const model = deriveWorkflowFlowModel(graph, [
      {
        target: "node",
        id: "brief",
        severity: "warning",
        message: "Capability requires approval before live provider use.",
      },
      {
        target: "edge",
        id: "source-to-brief",
        severity: "error",
        message: "Condition must compile before save.",
      },
    ]);

    expect(model.nodes[1]?.data.validationHints).toEqual([
      {
        severity: "warning",
        message: "Capability requires approval before live provider use.",
      },
    ]);
    expect(summarizeWorkflowValidationHints(model)).toEqual({
      errors: 1,
      warnings: 1,
    });
  });

  it("maps latest stage attempts onto workflow nodes", () => {
    const model = deriveWorkflowFlowModel(graph);
    const overlay = mapStageRunsToOverlay(
      [
        {
          stageKey: "source_grounded_brief",
          status: "failed",
          attemptNumber: 1,
          errorCode: "PROVIDER_DOWN",
        },
        {
          stageKey: "source_grounded_brief",
          status: "succeeded",
          attemptNumber: 2,
          summary: "Brief ready",
        },
      ],
      { source_grounded_brief: "brief" },
      model.nodes.map((node) => node.id),
    );

    expect(applyStatusOverlay(model, overlay).nodes[1]?.data).toMatchObject({
      status: "completed",
      runSummary: "Brief ready",
    });
  });
});
```

- [ ] **Step 4: Add the app-specific workflow canvas adapter**

Create `apps/web/src/features/workflows/workflowCanvasAdapter.ts`:

```ts
import {
  applyStatusOverlay,
  deriveWorkflowCanvasView,
  mapStageRunsToOverlay,
  type DurableWorkflowGraphForCanvas,
  type WorkflowCanvasView,
  type WorkflowStageKeyMap,
  type WorkflowStageRunForCanvas,
  type WorkflowValidationHint,
} from "@maestro-template/workflow-ui";

export type WorkflowCanvasAdapterInput = {
  readonly graph: DurableWorkflowGraphForCanvas | undefined;
  readonly stages: readonly WorkflowStageRunForCanvas[] | undefined;
  readonly stageMap?: WorkflowStageKeyMap;
  readonly validationHints?: readonly WorkflowValidationHint[];
};

export const deriveWorkflowCanvasAdapterView = (
  input: WorkflowCanvasAdapterInput,
): WorkflowCanvasView => {
  const view = deriveWorkflowCanvasView(
    input.graph,
    input.validationHints ?? [],
  );
  if (view.status !== "ready") return view;

  const overlays = mapStageRunsToOverlay(
    input.stages ?? [],
    input.stageMap ?? {},
    view.model.nodes.map((node) => node.id),
  );

  return {
    ...view,
    model: applyStatusOverlay(view.model, overlays),
  };
};
```

Create `apps/web/src/features/workflows/workflowCanvasAdapter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { deriveWorkflowCanvasAdapterView } from "./workflowCanvasAdapter";
import type { DurableWorkflowGraphForCanvas } from "@maestro-template/workflow-ui";

const graph: DurableWorkflowGraphForCanvas = {
  id: "workflow_source_grounded_plan",
  version: 1,
  startNodeId: "source",
  nodes: [
    {
      id: "source",
      label: "Source",
      kind: "source",
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: "brief",
      label: "Brief",
      kind: "capability",
      capability: "sourceGroundedBrief",
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
  ],
  edges: [
    {
      id: "source-to-brief",
      sourceNodeId: "source",
      targetNodeId: "brief",
    },
  ],
  joins: [],
};

describe("workflow canvas adapter", () => {
  it("keeps graph derivation separate from live stage rows", () => {
    const view = deriveWorkflowCanvasAdapterView({
      graph,
      stageMap: { source_grounded_brief: "brief" },
      stages: [
        {
          stageKey: "source_grounded_brief",
          status: "running",
          attemptNumber: 1,
          summary: "Calling provider",
        },
      ],
    });

    expect(view).toMatchObject({
      status: "ready",
      model: {
        nodes: [
          { id: "source" },
          {
            id: "brief",
            data: {
              status: "running",
              runSummary: "Calling provider",
            },
          },
        ],
      },
    });
  });
});
```

- [ ] **Step 5: Document the React Flow boundary**

In `docs/template/frontend-architecture.md`, add:

```md
## Workflow Canvas State

`packages/workflow-ui/src/workflowCanvasState.ts` is the reusable workflow
canvas primitive. It converts durable workflow graph data into loading, empty,
and ready canvas states and overlays latest stage attempts onto nodes. It has no
React, Convex, Confect, Effect runtime, or generated-ref imports.

`packages/workflow-ui/src/index.tsx` renders the pure model with React Flow.
`apps/web/src/features/workflows/workflowCanvasAdapter.ts` is the app boundary
that combines a graph source with live stage rows. React Flow interactions must
emit workflow graph commands; React Flow node/edge objects are not persisted as
the source of truth.
```

In `docs/template/workflow-authoring-guide.md`, add:

```md
## Canvas Boundary

The workflow canvas is a projection of durable workflow graph data. Persisted
workflow records store the graph contract and stage/event ledgers. The web app
derives React Flow nodes and edges from that graph, overlays
`workflowStageRuns`, and saves domain workflow commands rather than raw React
Flow mutations.
```

- [ ] **Step 6: Run workflow UI checks**

Run:

```bash
rtk pnpm --dir packages/workflow-ui test
rtk pnpm --dir packages/workflow-ui typecheck
rtk pnpm --dir apps/web test src/features/workflows/workflowCanvasAdapter.test.ts
rtk pnpm --dir apps/web typecheck
rtk host-test-slot --class focused pnpm check:frontend-effect-boundary
```

Expected: every command exits `0`.

- [ ] **Step 7: Commit**

Run:

```bash
rtk git add packages/workflow-ui/src/workflowCanvasState.ts packages/workflow-ui/src/index.tsx packages/workflow-ui/src/index.test.tsx apps/web/src/features/workflows/workflowCanvasAdapter.ts apps/web/src/features/workflows/workflowCanvasAdapter.test.ts docs/template/frontend-architecture.md docs/template/workflow-authoring-guide.md && rtk git commit -m "feat: extract workflow canvas state primitive"
```

## Task 27: Add Exact-Pinned Editor Dependencies And Packages

**Files:**

- Modify: `packages/convex/package.json`
- Modify: `apps/web/package.json`
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `packages/editor-core/package.json`
- Create: `packages/editor-core/tsconfig.json`
- Create: `packages/editor-core/src/index.ts`
- Create: `packages/editor-core/src/index.test.ts`
- Create: `packages/editor-react/package.json`
- Create: `packages/editor-react/tsconfig.json`
- Create: `packages/editor-react/src/index.tsx`
- Create: `packages/editor-react/src/client.tsx`
- Create: `packages/editor-react/src/style.d.ts`
- Create: `tooling/effectified-api-proof/editor-sync-proof.ts`
- Modify: `tooling/effectified-api-proof/package.json`
- Modify: `docs/template/repo-map.md`
- Modify: `docs/template/confect-effect-guide.md`

- [ ] **Step 1: Add exact editor dependencies**

Run the package checkpoint:

```bash
rtk npm view @blocknote/core version
rtk npm view @blocknote/react version
rtk npm view @convex-dev/prosemirror-sync version
rtk npm view @tiptap/core version
rtk npm view @tiptap/pm version
rtk npm view decode-named-character-reference version
```

Expected: the commands print `0.51.4`, `0.51.4`, `0.2.5`, `3.27.1`, `3.27.1`,
and the current `decode-named-character-reference` patch, or newer compatible
patches. If newer compatible patches exist, pin the whole imported family
deliberately and record the decision in `docs/template/confect-effect-guide.md`.
Do not add `@blocknote/mantine` in this task: the wrapper imports
`BlockNoteViewRaw` from `@blocknote/react`, and adding Mantine without
`@mantine/core` / `@mantine/hooks` peers creates a false package requirement.

In `packages/convex/package.json` dependencies, add:

```json
"@blocknote/core": "0.51.4",
"@convex-dev/prosemirror-sync": "0.2.5",
"@tiptap/core": "3.27.1",
"@tiptap/pm": "3.27.1"
```

In `tooling/effectified-api-proof/package.json`, add the same exact editor proof
dependencies:

```json
"@blocknote/core": "0.51.4",
"@convex-dev/prosemirror-sync": "0.2.5",
"@tiptap/core": "3.27.1",
"@tiptap/pm": "3.27.1",
"decode-named-character-reference": "1.3.0",
"react": "19.1.0",
"react-dom": "19.1.0"
```

In `apps/web/package.json` dependencies, add:

```json
"@blocknote/core": "0.51.4",
"@blocknote/react": "0.51.4",
"@convex-dev/prosemirror-sync": "0.2.5",
"@tiptap/core": "3.27.1",
"@tiptap/pm": "3.27.1",
"decode-named-character-reference": "1.3.0",
"@maestro-template/editor-core": "workspace:*",
"@maestro-template/editor-react": "workspace:*"
```

Create `tooling/effectified-api-proof/editor-sync-proof.ts`:

```ts
import { BlockNoteEditor } from "@blocknote/core";
import { ProsemirrorSync } from "@convex-dev/prosemirror-sync";
import { useBlockNoteSync } from "@convex-dev/prosemirror-sync/blocknote";

declare const component: ConstructorParameters<typeof ProsemirrorSync>[0];
const sync = new ProsemirrorSync(component);

export const syncApi = sync.syncApi({
  checkRead: async (_ctx, id) => {
    void id;
  },
  checkWrite: async (_ctx, id) => {
    void id;
  },
  onSnapshot: async (_ctx, id, snapshot, version) => {
    void id;
    void snapshot;
    void version;
  },
});

void BlockNoteEditor.create;
void useBlockNoteSync;
```

- [ ] **Step 2: Create `editor-core`**

Create `packages/editor-core/package.json`:

```json
{
  "name": "@maestro-template/editor-core",
  "private": true,
  "type": "module",
  "main": "src/index.ts",
  "types": "src/index.ts",
  "exports": {
    ".": {
      "types": "./src/index.ts",
      "default": "./src/index.ts"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json --outDir dist --declaration",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "effect": "3.21.4"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vitest": "^3.0.0"
  }
}
```

Create `packages/editor-core/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "rootDir": ".",
    "outDir": "dist"
  },
  "include": ["src/**/*.ts", "src/**/*.tsx", "src/**/*.mts", "test/**/*.ts"]
}
```

Create `packages/editor-core/src/index.ts`:

```ts
import * as Schema from "effect/Schema";

export const EditorDocumentTarget = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("brainPage"), id: Schema.String }),
);

export type EditorDocumentTarget = Schema.Schema.Type<
  typeof EditorDocumentTarget
>;

export const encodeEditorDocumentId = (target: EditorDocumentTarget): string =>
  `${target.kind}:${target.id}`;

export const parseEditorDocumentId = (value: string): EditorDocumentTarget => {
  const [kind, ...rest] = value.split(":");
  const id = rest.join(":");
  if (kind === "brainPage" && id.length > 0) {
    return { kind, id };
  }
  throw new Error(`Invalid editor document id: ${value}`);
};

export const emptyBlockNoteDocument = () => ({
  type: "doc",
  content: [] as unknown[],
});
```

Create `packages/editor-core/src/index.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  encodeEditorDocumentId,
  emptyBlockNoteDocument,
  parseEditorDocumentId,
} from "./index";

describe("editor core", () => {
  it("round-trips editor document ids", () => {
    expect(
      parseEditorDocumentId(
        encodeEditorDocumentId({ kind: "brainPage", id: "page_1" }),
      ),
    ).toEqual({
      kind: "brainPage",
      id: "page_1",
    });
  });

  it("rejects generic document ids until a workspace resolver exists", () => {
    expect(() => parseEditorDocumentId("document:doc_1")).toThrow(
      "Invalid editor document id",
    );
    expect(() => parseEditorDocumentId("doc_1")).toThrow(
      "Invalid editor document id",
    );
  });

  it("returns a fresh empty document object", () => {
    expect(emptyBlockNoteDocument()).toEqual({ type: "doc", content: [] });
    expect(emptyBlockNoteDocument()).not.toBe(emptyBlockNoteDocument());
  });
});
```

- [ ] **Step 3: Create `editor-react` package shell**

Create `packages/editor-react/package.json`:

```json
{
  "name": "@maestro-template/editor-react",
  "private": true,
  "type": "module",
  "main": "src/index.tsx",
  "types": "src/index.tsx",
  "exports": {
    ".": {
      "types": "./src/index.tsx",
      "default": "./src/index.tsx"
    },
    "./client": {
      "types": "./src/client.tsx",
      "default": "./src/client.tsx"
    }
  },
  "scripts": {
    "build": "tsc -p tsconfig.json --outDir dist --declaration",
    "typecheck": "tsc -p tsconfig.json --noEmit",
    "test": "vitest run --passWithNoTests"
  },
  "dependencies": {
    "@blocknote/core": "0.51.4",
    "@blocknote/react": "0.51.4",
    "@convex-dev/prosemirror-sync": "0.2.5",
    "@maestro-template/editor-core": "workspace:*",
    "@tiptap/core": "3.27.1",
    "@tiptap/pm": "3.27.1",
    "convex": "1.42.1",
    "decode-named-character-reference": "1.3.0",
    "react": "19.1.0",
    "react-dom": "19.1.0"
  },
  "devDependencies": {
    "@types/react": "^19.2.17",
    "typescript": "^5.0.0",
    "vitest": "^3.0.0"
  }
}
```

Create `packages/editor-react/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "composite": true,
    "jsx": "react-jsx",
    "rootDir": ".",
    "outDir": "dist"
  },
  "include": [
    "src/**/*.ts",
    "src/**/*.tsx",
    "src/**/*.mts",
    "test/**/*.ts",
    "test/**/*.tsx",
    "test/**/*.mts"
  ]
}
```

Create `packages/editor-react/src/index.tsx`:

```tsx
export {
  emptyBlockNoteDocument,
  encodeEditorDocumentId,
  parseEditorDocumentId,
} from "@maestro-template/editor-core";
```

Create `packages/editor-react/src/client.tsx` as a temporary browser-only
subpath placeholder:

```tsx
export {};
```

The root export must stay server-safe: no BlockNote React imports, no
`@convex-dev/prosemirror-sync/blocknote` import, and no CSS import. Browser-only
editor UI replaces this placeholder in Task 30 and is exported from
`@maestro-template/editor-react/client`.

Create `packages/editor-react/src/style.d.ts` so the package typecheck accepts
the BlockNote CSS import added in Task 30:

```ts
declare module "*.css";
```

- [ ] **Step 4: Add TypeScript project references**

In root `tsconfig.json`, add these references next to the other `packages/*`
references:

```json
{ "path": "./packages/editor-core" },
{ "path": "./packages/editor-react" }
```

- [ ] **Step 5: Document editor package responsibilities**

In `docs/template/repo-map.md`, add:

```md
### Editor Packages

- `packages/editor-core`: framework-agnostic editor document ids, codecs,
  snapshot helpers, and schema-safe primitives shared by Convex and React.
- `packages/editor-react`: pure root helper re-exports plus a browser-only
  `./client` subpath for the BlockNote/ProseMirror React wrapper and sync
  adapter. The root export must remain safe for server-side imports.
- `packages/convex/confect/editor`: backend ProseMirror schema seam, sync
  registration helpers, typed errors, and Confect/plain-Convex boundaries.
```

In `docs/template/confect-effect-guide.md`, add:

```md
## Editor Substrate Pins

The optional editor substrate is exact-pinned because BlockNote, Tiptap, and
ProseMirror sync share runtime schema assumptions. Recheck npm metadata before
editing package manifests; pin the BlockNote family together, pin the Tiptap
family together, and run the ProseMirror schema drift test after every bump. The
backend derives its transform schema from a headless
`BlockNoteEditor.create().pmSchema` guard rather than maintaining a second
handwritten ProseMirror schema.
```

- [ ] **Step 6: Install and test**

Run:

```bash
rtk pnpm install
rtk pnpm --dir packages/editor-core test
rtk pnpm --dir packages/editor-core typecheck
rtk pnpm --dir packages/editor-react typecheck
rtk pnpm --dir tooling/effectified-api-proof typecheck
rtk host-test-slot --class focused pnpm check:effectified-api-proof
rtk host-test-slot --class focused pnpm check:deps
```

Expected: all commands exit `0`; `pnpm-lock.yaml` records exact editor versions.

- [ ] **Step 6A: Enable the full API proof gate**

Now that the PostHog and editor proof files and dependencies exist, update the
root `verify` script in `package.json` to include:

```json
"pnpm check:effectified-api-proof"
```

Place it near the Confect compatibility/configuration gates. Do not enable it
before Task 25A and this task have added their versioned dependencies, or the
proof package will fail by design.

- [ ] **Step 7: Commit**

Run:

```bash
rtk git add package.json packages/convex/package.json apps/web/package.json tooling/effectified-api-proof tsconfig.json packages/editor-core packages/editor-react pnpm-lock.yaml docs/template/repo-map.md docs/template/confect-effect-guide.md && rtk git commit -m "feat: add exact-pinned editor packages"
```

## Task 28: Add Backend ProseMirror Schema Seam With Drift Guard

**Files:**

- Create: `packages/convex/confect/editor/prosemirror.ts`
- Create: `packages/convex/test/editor-prosemirror.test.ts`
- Modify: `packages/convex/convex/convex.config.ts`

- [ ] **Step 1: Mount ProseMirror sync component**

In `packages/convex/convex/convex.config.ts`, import:

```ts
import prosemirrorSync from "@convex-dev/prosemirror-sync/convex.config.js";
```

Then after existing component registrations, add:

```ts
app.use(prosemirrorSync);
```

- [ ] **Step 2: Add backend schema seam**

This intentionally follows the Maestro seam in
`/Users/headless/maestro/packages/convex/convex/adapters/prosemirror.ts`: build
a headless `BlockNoteEditor.create()` without mounting DOM, read
`BlockNoteEditor#pmSchema` as `unknown`, and fail loudly if BlockNote changes
the shape. The point is to derive the server transform schema from the same
BlockNote defaults the browser editor renders, instead of maintaining a second
ProseMirror schema by hand.

Create `packages/convex/confect/editor/prosemirror.ts`:

```ts
import { BlockNoteEditor } from "@blocknote/core";
import { ProsemirrorSync } from "@convex-dev/prosemirror-sync";
import { Schema as ProseMirrorSchema } from "@tiptap/pm/model";
import { ConvexError } from "convex/values";
import { components } from "../../convex/_generated/api";

export const prosemirrorSync = new ProsemirrorSync(components.prosemirrorSync);

let cachedSchema: ProseMirrorSchema<string, string> | null = null;

const isProseMirrorSchema = (
  value: unknown,
): value is ProseMirrorSchema<string, string> =>
  value instanceof ProseMirrorSchema;

const readPmSchema = (editor: BlockNoteEditor): unknown =>
  Reflect.get(editor, "pmSchema");

export const getBlockNoteSchema = (): ProseMirrorSchema<string, string> => {
  if (cachedSchema !== null) return cachedSchema;
  const editor = BlockNoteEditor.create();
  const pmSchema = readPmSchema(editor);
  if (!isProseMirrorSchema(pmSchema)) {
    throw new ConvexError({
      code: "PROSEMIRROR_SCHEMA_DRIFT",
      message: "BlockNoteEditor.pmSchema is not a ProseMirror Schema instance",
    });
  }
  cachedSchema = pmSchema;
  return cachedSchema;
};
```

- [ ] **Step 3: Add backend seam tests**

Create `packages/convex/test/editor-prosemirror.test.ts`:

```ts
import { Schema as ProseMirrorSchema } from "@tiptap/pm/model";
import { ConvexError } from "convex/values";
import { describe, expect, it, vi } from "vitest";
import {
  getBlockNoteSchema,
  prosemirrorSync,
} from "../confect/editor/prosemirror";

describe("editor prosemirror seam", () => {
  it("exposes a ProsemirrorSync singleton", () => {
    expect(typeof prosemirrorSync).toBe("object");
  });

  it("memoizes the BlockNote ProseMirror schema", () => {
    expect(getBlockNoteSchema()).toBeInstanceOf(ProseMirrorSchema);
    expect(getBlockNoteSchema()).toBe(getBlockNoteSchema());
  });

  it("throws a public drift error when BlockNote pmSchema changes shape", async () => {
    vi.resetModules();
    vi.doMock("@blocknote/core", () => ({
      BlockNoteEditor: { create: () => ({ pmSchema: {} }) },
    }));
    const module = await import("../confect/editor/prosemirror");
    expect(() => module.getBlockNoteSchema()).toThrow(ConvexError);
    vi.doUnmock("@blocknote/core");
    vi.resetModules();
  });
});
```

- [ ] **Step 4: Run codegen and focused tests**

Run:

```bash
rtk pnpm confect:codegen
rtk pnpm --dir packages/convex check:convex
rtk pnpm --dir packages/convex test editor-prosemirror.test.ts
rtk pnpm --dir packages/convex typecheck
```

Expected: all commands exit `0`; generated Convex component refs include
`components.prosemirrorSync`.

- [ ] **Step 5: Commit**

Run:

```bash
rtk git add packages/convex/convex/convex.config.ts packages/convex/confect/editor/prosemirror.ts packages/convex/test/editor-prosemirror.test.ts packages/convex/confect/_generated packages/convex/convex/_generated packages/convex/convex/schema.ts && rtk git commit -m "feat: add editor ProseMirror backend seam"
```

## Task 29: Add Editor Sync API Registration

**Files:**

- Modify: `packages/convex/confect/tables/brainPages.ts`
- Modify: `packages/convex/confect/brain/pages.spec.ts`
- Modify: `packages/convex/confect/brain/pages.impl.ts`
- Create: `packages/convex/confect/editor/documentTargets.ts`
- Create: `packages/convex/confect/editor/sync.ts`
- Create: `packages/convex/convex/editorSync.ts`
- Create: `packages/convex/test/editor-sync.test.ts`

- [ ] **Step 0: Inspect installed sync API signatures**

After Task 27 installs `@convex-dev/prosemirror-sync`, inspect the package
types:

```bash
rtk rg -n "syncApi|checkRead|checkWrite|onSnapshot" node_modules/@convex-dev/prosemirror-sync packages/convex/node_modules/@convex-dev/prosemirror-sync
```

Expected: the output shows the current `syncApi` option signatures. If the
signatures differ from the concrete code below, update the parameter names but
preserve the required behavior: both read and write checks parse `documentId`,
resolve its workspace server-side, and enforce workspace role before allowing
sync.

- [ ] **Step 1: Add generic document target parser**

Create `packages/convex/confect/editor/documentTargets.ts`:

```ts
export type EditorTarget = { readonly kind: "brainPage"; readonly id: string };

export const parseEditorTarget = (documentId: string): EditorTarget => {
  const [kind, ...rest] = documentId.split(":");
  const id = rest.join(":");
  if (kind === "brainPage" && id.length > 0) {
    return { kind, id };
  }
  throw new Error(`Unsupported editor document target: ${documentId}`);
};
```

Do not accept raw document ids or a generic `document:<id>` target in this first
slice. The only resolver below knows how to derive workspace membership from
`brainPages`, so every accepted id must be prefixed as `brainPage:<id>`.

- [ ] **Step 2: Add sync authorization seam**

Create `packages/convex/confect/editor/sync.ts`:

```ts
import type { GenericMutationCtx, GenericQueryCtx } from "convex/server";
import type { DataModel } from "../../convex/_generated/dataModel";
import { parseEditorTarget } from "./documentTargets";

export type EditorRole = "viewer" | "editor";

type EditorAuthCtx = GenericQueryCtx<DataModel> | GenericMutationCtx<DataModel>;

export const resolveEditorWorkspaceId = async (
  ctx: EditorAuthCtx,
  documentId: string,
): Promise<string | null> => {
  const target = parseEditorTarget(documentId);
  if (target.kind !== "brainPage") return null;
  const pageId = ctx.db.normalizeId("brainPages", target.id);
  if (pageId === null) return null;
  const page = await ctx.db.get(pageId);
  return page?.workspaceId ?? null;
};

export const requireEditorDocumentAccess = async (
  ctx: EditorAuthCtx,
  documentId: string,
  role: EditorRole,
): Promise<void> => {
  const workspaceId = await resolveEditorWorkspaceId(ctx, documentId);
  if (workspaceId === null) {
    throw new Error("Editor document target is not readable.");
  }

  const identity = await ctx.auth.getUserIdentity();
  if (identity === null) {
    throw new Error("Editor sync requires authentication.");
  }

  const user = await ctx.db
    .query("users")
    .withIndex("by_subject", (q) => q.eq("subject", identity.subject))
    .unique();

  if (user === null) {
    throw new Error("Editor sync requires a provisioned user.");
  }

  const member = await ctx.db
    .query("workspaceMembers")
    .withIndex("by_workspace_user", (q) =>
      q.eq("workspaceId", workspaceId).eq("userId", user._id),
    )
    .unique();

  if (member === null || member.status !== "active") {
    throw new Error("Editor sync requires workspace membership.");
  }

  if (
    role === "editor" &&
    member.role !== "owner" &&
    member.role !== "admin" &&
    member.role !== "editor"
  ) {
    throw new Error("Editor sync requires editor access.");
  }
};
```

This deliberately follows the current template table shape: `users.by_subject`
resolves WorkOS/Convex identity subject to a user row, and
`workspaceMembers.by_workspace_user` checks membership by `workspaceId` plus
`userId`. If those tables change before implementation, adapt this helper to the
current table shape and add the exact index in the same task. Do not leave
read/write checks open while waiting for a future task.

- [ ] **Step 3: Add a Brain page snapshot mirror mutation**

In `packages/convex/confect/tables/brainPages.ts`, add optional snapshot mirror
fields:

```ts
editorSnapshotJson: Schema.optional(Schema.String),
editorSnapshotVersion: Schema.optional(Schema.Number),
```

In `packages/convex/confect/brain/pages.spec.ts`, add an internal mutation:

```ts
import { NotFound, ValidationFailed } from "../errors";

export const RecordSnapshotArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  pageId: Id("brainPages"),
  snapshot: Schema.String,
  version: Schema.Number,
});

export const RecordSnapshotReturns = Schema.Struct({
  ok: Schema.Literal(true),
});

const recordSnapshotInternal = FunctionSpec.internalMutation({
  name: "recordSnapshotInternal",
  args: () => RecordSnapshotArgs,
  returns: () => RecordSnapshotReturns,
  error: () => Schema.Union(NotFound, ValidationFailed),
});
```

Add `recordSnapshotInternal` to the group. In `brain/pages.impl.ts`, implement
it by loading `pageId`, verifying `page.workspaceId === workspaceId`, and
patching:

```ts
{
  editorSnapshotJson: snapshot,
  editorSnapshotVersion: version,
  updatedAt: yield* Clock.currentTimeMillis,
}
```

If the page is missing, fail with `NotFound`; if the page belongs to another
workspace, fail with `ValidationFailed`. Do not call this mutation from the
client; it exists only for the ProseMirror sync component's `onSnapshot` hook.

- [ ] **Step 4: Add sync registration**

Create `packages/convex/convex/editorSync.ts`:

```ts
import type { GenericMutationCtx } from "convex/server";
import type { DataModel } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { prosemirrorSync } from "../confect/editor/prosemirror";
import { parseEditorTarget } from "../confect/editor/documentTargets";
import { requireEditorDocumentAccess } from "../confect/editor/sync";

export async function recordEditorSnapshot(
  ctx: GenericMutationCtx<DataModel>,
  documentId: string,
  snapshot: string,
  _version: number,
): Promise<void> {
  const target = parseEditorTarget(documentId);
  if (target.kind === "brainPage") {
    const pageId = ctx.db.normalizeId("brainPages", target.id);
    if (pageId === null) return;
    const page = await ctx.db.get(pageId);
    if (page === null) return;
    await ctx.runMutation(internal.brain.pages.recordSnapshotInternal, {
      workspaceId: page.workspaceId,
      pageId,
      snapshot,
      version: _version,
    });
  }
}

export const {
  getSnapshot,
  submitSnapshot,
  latestVersion,
  getSteps,
  submitSteps,
} = prosemirrorSync.syncApi<DataModel>({
  checkRead: async (ctx, documentId) => {
    await requireEditorDocumentAccess(ctx, documentId, "viewer");
  },
  checkWrite: async (ctx, documentId) => {
    await requireEditorDocumentAccess(ctx, documentId, "editor");
  },
  onSnapshot: recordEditorSnapshot,
});
```

- [ ] **Step 5: Add sync tests**

Create `packages/convex/test/editor-sync.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { parseEditorTarget } from "../confect/editor/documentTargets";
import { requireEditorDocumentAccess } from "../confect/editor/sync";
import {
  getSnapshot,
  submitSnapshot,
  latestVersion,
  getSteps,
  submitSteps,
  recordEditorSnapshot,
} from "../convex/editorSync";

describe("editor sync registration", () => {
  it("parses prefixed and raw document ids", () => {
    expect(parseEditorTarget("brainPage:page_1")).toEqual({
      kind: "brainPage",
      id: "page_1",
    });
    expect(() => parseEditorTarget("document_1")).toThrow(
      "Unsupported editor document target",
    );
    expect(() => parseEditorTarget("document:document_1")).toThrow(
      "Unsupported editor document target",
    );
  });

  it("registers the five sync functions", () => {
    for (const fn of [
      getSnapshot,
      submitSnapshot,
      latestVersion,
      getSteps,
      submitSteps,
    ]) {
      expect(typeof fn).toBe("function");
    }
  });

  it("denies unauthenticated editor sync access", async () => {
    const ctx = {
      auth: { getUserIdentity: vi.fn().mockResolvedValue(null) },
      db: {
        normalizeId: vi.fn((_table: string, id: string) => id),
        get: vi.fn().mockResolvedValue({ workspaceId: "workspaces_1" }),
      },
    };
    await expect(
      requireEditorDocumentAccess(
        ctx as never,
        "brainPage:brainPages_1",
        "viewer",
      ),
    ).rejects.toThrow("authentication");
  });

  it("resolves users by subject before checking workspace membership", async () => {
    const withIndex = vi
      .fn()
      .mockReturnValueOnce({
        unique: vi.fn().mockResolvedValue({ _id: "users_1" }),
      })
      .mockReturnValueOnce({
        unique: vi.fn().mockResolvedValue({
          workspaceId: "workspaces_1",
          userId: "users_1",
          role: "editor",
          status: "active",
        }),
      });
    const ctx = {
      auth: {
        getUserIdentity: vi.fn().mockResolvedValue({ subject: "subject_1" }),
      },
      db: {
        normalizeId: vi.fn((_table: string, id: string) => id),
        get: vi.fn().mockResolvedValue({ workspaceId: "workspaces_1" }),
        query: vi.fn(() => ({ withIndex })),
      },
    };
    await expect(
      requireEditorDocumentAccess(
        ctx as never,
        "brainPage:brainPages_1",
        "editor",
      ),
    ).resolves.toBeUndefined();
    expect(ctx.db.query.mock.calls.map((call) => call[0])).toEqual([
      "users",
      "workspaceMembers",
    ]);
    expect(withIndex.mock.calls.map((call) => call[0])).toEqual([
      "by_subject",
      "by_workspace_user",
    ]);
  });

  it("derives workspace id from the stored Brain page", async () => {
    const ctx = {
      db: {
        normalizeId: vi.fn((_table: string, id: string) => id),
        get: vi.fn().mockResolvedValue({ workspaceId: "workspaces_1" }),
      },
      runMutation: vi.fn().mockResolvedValue(null),
    };
    await recordEditorSnapshot(ctx as never, "brainPage:brainPages_1", "[]", 1);
    expect(ctx.runMutation.mock.calls[0]?.[1]).toMatchObject({
      workspaceId: "workspaces_1",
      pageId: "brainPages_1",
      snapshot: "[]",
      version: 1,
    });
  });
});
```

- [ ] **Step 6: Run codegen and tests**

Run:

```bash
rtk pnpm confect:codegen
rtk pnpm --dir packages/convex test editor-sync.test.ts editor-prosemirror.test.ts
rtk pnpm --dir packages/convex typecheck
```

Expected: all commands exit `0`.

- [ ] **Step 7: Commit**

Run:

```bash
rtk git add packages/convex/confect/tables/brainPages.ts packages/convex/confect/brain/pages.spec.ts packages/convex/confect/brain/pages.impl.ts packages/convex/confect/editor packages/convex/convex/editorSync.ts packages/convex/test/editor-sync.test.ts packages/convex/confect/_generated packages/convex/convex/_generated packages/convex/convex/schema.ts && rtk git commit -m "feat: add editor sync API registration"
```

## Task 30: Add React BlockNote Sync Wrapper

**Files:**

- Modify: `packages/editor-react/src/client.tsx`
- Create: `packages/editor-react/src/BlockNoteSyncEditor.tsx`
- Create: `packages/editor-react/src/BlockNoteSyncEditor.test.tsx`

- [ ] **Step 1: Implement wrapper component**

Create `packages/editor-react/src/BlockNoteSyncEditor.tsx`:

```tsx
import {
  BlockNoteEditor,
  type BlockSchema,
  type InlineContentSchema,
  type StyleSchema,
} from "@blocknote/core";
import { BlockNoteViewRaw as BlockNoteView } from "@blocknote/react";
import "@blocknote/react/style.css";
import { useBlockNoteSync } from "@convex-dev/prosemirror-sync/blocknote";
import { useEffect, useRef } from "react";
import { emptyBlockNoteDocument } from "@maestro-template/editor-core";

type OpenEditor = BlockNoteEditor<
  BlockSchema,
  InlineContentSchema,
  StyleSchema
>;
type SyncState = ReturnType<typeof useBlockNoteSync<OpenEditor>>;

export type BlockNoteSyncEditorProps = {
  readonly api: Parameters<typeof useBlockNoteSync<OpenEditor>>[0];
  readonly documentId: string;
  readonly snapshotDebounceMs: number;
  readonly editable?: boolean;
};

export const shouldBootstrapCreate = (
  alreadyCreated: boolean,
  sync: { readonly isLoading: boolean; readonly editor: unknown },
): boolean => !alreadyCreated && !sync.isLoading && sync.editor === null;

const useBootstrapEmptyDoc = (sync: SyncState): void => {
  const createdRef = useRef(false);
  useEffect(() => {
    if (!shouldBootstrapCreate(createdRef.current, sync)) return;
    if (sync.isLoading || sync.editor !== null) return;
    createdRef.current = true;
    void sync.create(emptyBlockNoteDocument());
  }, [sync]);
};

export function BlockNoteSyncEditor({
  api,
  documentId,
  snapshotDebounceMs,
  editable = false,
}: BlockNoteSyncEditorProps) {
  const debounceRef = useRef(snapshotDebounceMs);
  const sync = useBlockNoteSync<OpenEditor>(api, documentId, {
    snapshotDebounceMs: debounceRef.current,
  });
  useBootstrapEmptyDoc(sync);
  if (sync.isLoading || sync.editor === null) {
    return <div data-editor-state="loading" />;
  }
  return (
    <BlockNoteView
      editor={sync.editor}
      editable={editable}
      formattingToolbar={false}
      slashMenu={false}
      sideMenu={false}
      linkToolbar={false}
      tableHandles={false}
      filePanel={false}
      emojiPicker={false}
    />
  );
}
```

- [ ] **Step 2: Replace the browser-only client subpath placeholder**

Replace `packages/editor-react/src/client.tsx`:

```tsx
export {
  BlockNoteSyncEditor,
  shouldBootstrapCreate,
} from "./BlockNoteSyncEditor";
export type { BlockNoteSyncEditorProps } from "./BlockNoteSyncEditor";
```

Do not export `BlockNoteSyncEditor` from `packages/editor-react/src/index.tsx`.
The root export is intentionally pure/server-safe. Web code that renders the
editor must import from `@maestro-template/editor-react/client`.

- [ ] **Step 3: Add pure decision tests**

Create `packages/editor-react/src/BlockNoteSyncEditor.test.tsx`:

```tsx
import { describe, expect, it } from "vitest";
import { shouldBootstrapCreate } from "./BlockNoteSyncEditor";

describe("BlockNoteSyncEditor decisions", () => {
  it("bootstraps only once after loading settles with no editor", () => {
    expect(
      shouldBootstrapCreate(false, { isLoading: true, editor: null }),
    ).toBe(false);
    expect(
      shouldBootstrapCreate(false, { isLoading: false, editor: null }),
    ).toBe(true);
    expect(
      shouldBootstrapCreate(true, { isLoading: false, editor: null }),
    ).toBe(false);
    expect(shouldBootstrapCreate(false, { isLoading: false, editor: {} })).toBe(
      false,
    );
  });
});
```

- [ ] **Step 4: Run tests**

Run:

```bash
rtk pnpm --dir packages/editor-react test
rtk pnpm --dir packages/editor-react typecheck
rtk pnpm --dir apps/web typecheck
```

Expected: all commands exit `0`, and `apps/web` imports any rendered
`BlockNoteSyncEditor` from `@maestro-template/editor-react/client`, not from the
package root.

- [ ] **Step 5: Commit**

Run:

```bash
rtk git add packages/editor-react && rtk git commit -m "feat: add BlockNote sync wrapper"
```

## Task 31: Upgrade Manifest Schemas To Effect JSON Schema

**Files:**

- Modify: `packages/convex/confect/capabilities/_kit/capability.ts`
- Modify: `tooling/confect-manifest/src/index.ts`
- Modify: `tooling/confect-manifest/src/generate.ts`
- Modify: `packages/convex/confect/manifest/openapi.ts`
- Modify: `packages/convex/confect/manifest/mcp.ts`
- Modify: `docs/template/confect-effect-guide.md`

- [ ] **Step 1: Reuse the schema handles already present in manifest metadata**

Task 14 and Task 16 already add `argsSchemaName` and `returnsSchemaName` to
`ContractFunctionManifest` and to each spec-bound manifest entry. Do not add a
second schema-name mechanism in this task. Instead, verify those fields are
present in `tooling/confect-manifest/src/index.ts`, verify Task 16's
`schemaRegistry` exports cover every schema name, and verify every generated
manifest entry names the schemas before adding JSON Schema output.

The required manifest fields are:

```ts
readonly argsSchemaName: string;
readonly returnsSchemaName: string;
```

Do not serialize live Effect schema objects into
`packages/template-core/src/generated/confectManifest.ts`; only serialize schema
names and generated JSON schema objects.

- [ ] **Step 2: Prove the Effect JSON Schema import**

Before editing generator code, verify the pinned Effect module path:

```bash
rtk pnpm exec tsx -e 'import * as JSONSchema from "effect/JSONSchema"; console.log(typeof JSONSchema.make)'
```

Expected: prints `function`. If the pinned Effect package exposes JSON Schema
projection from a different import path, update this task, the generator, and
`docs/template/confect-effect-guide.md` before continuing.

- [ ] **Step 3: Generate JSON schema objects from the spec-bound registry**

Use Effect's `JSONSchema.make` per
https://effect.website/docs/schema/json-schema/ for each exported args and
returns schema handle in the combined Task 16 `schemaRegistry`.

Generator output shape:

```ts
export const confectJsonSchemas = {
  openApi31: {
    "brain.pages.createMarkdown.args": {
      /* JSONSchema.make(schema, { target: "openApi3.1" }) */
    },
    "brain.pages.createMarkdown.returns": {
      /* JSONSchema.make(schema, { target: "openApi3.1" }) */
    },
  },
  mcp: {
    "brain.pages.createMarkdown.args": {
      /* JSONSchema.make(schema, { target: "jsonSchema2020-12" }) */
    },
    "brain.pages.createMarkdown.returns": {
      /* JSONSchema.make(schema, { target: "jsonSchema2020-12" }) */
    },
  },
} as const;
```

OpenAPI builders must use `JSONSchema.make(schema, { target: "openApi3.1" })`.
MCP builders must use `JSONSchema.make(schema, { target: "jsonSchema2020-12" })`
unless the MCP server/runtime being integrated requires a different JSON Schema
draft, in which case document the runtime requirement next to the generator.

If `JSONSchema.make` rejects a schema, fix the schema to satisfy Confect schema
restrictions: no `undefined`, no `void`, no non-Convex encoded values, and no
schema context.

- [ ] **Step 4: Wire OpenAPI and MCP builders to generated schema**

Replace `objectSchema` fallback in `openapi.ts` and `mcp.ts` with lookups into
`confectJsonSchemas.openApi31` and `confectJsonSchemas.mcp`, respectively.

- [ ] **Step 5: Add tests**

Update HTTP/OpenAPI tests to assert:

- `brain.pages.createMarkdown` request schema has required `workspaceId`,
  `slug`, `title`, and `markdown`;
- typed error tags appear in `x-maestro-typed-errors`;
- MCP tool input schema for `template.brain.pages.createMarkdown` is not the
  object fallback.

- [ ] **Step 6: Run checks**

Run:

```bash
rtk pnpm confect:manifest
rtk host-test-slot --class focused pnpm check:confect-manifest
rtk pnpm --dir packages/convex test http-docs.test.ts
rtk pnpm --dir tooling/workflow test
rtk host-test-slot --class focused pnpm typecheck
```

Expected: all commands exit `0`.

- [ ] **Step 7: Commit**

Run:

```bash
rtk git add packages/convex/confect/capabilities/_kit/capability.ts tooling/confect-manifest packages/template-core/src/generated/confectManifest.ts packages/convex/confect/manifest packages/convex/test/http-docs.test.ts tooling/workflow/src/index.ts docs/template/confect-effect-guide.md && rtk git commit -m "feat: emit JSON schemas from Effect contracts"
```

## Task 32: Update Docs To Match The New Contract Model

**Files:**

- Modify: `docs/template/confect-effect-guide.md`
- Modify: `docs/template/generator-output-contract.md`
- Modify: `docs/template/how-to-add-capability.md`
- Modify: `docs/template/how-to-add-workflow.md`
- Modify: `docs/template/how-to-add-agent.md`
- Modify: `docs/template/repo-map.md`
- Modify: `docs/template/security.md`
- Modify: `docs/template/effectification-status.md`

- [ ] **Step 0: Reconcile docs already updated per phase**

Each implementation phase above updates the docs it owns before committing. This
task is a reconciliation pass, not the first time docs are written. Before
editing, read the phase commits and verify the status ledger already records the
completed phases, generated artifacts, known gaps, and verification rows.

- [ ] **Step 1: Update Confect guide**

Ensure the guide states:

- generated refs are the client/server contract boundary;
- public errors are `Schema.TaggedError` classes;
- `@confect/test` is required for contract tests;
- manifest metadata comes from spec-bound builder helpers and is parity-checked
  against generated refs;
- `effect/JSONSchema` output backs OpenAPI/MCP schemas;
- public surfaces default to denied exposure.

- [ ] **Step 2: Update generator docs**

Ensure generator docs state:

- `template:add-capability` emits flat Confect files under
  `packages/convex/confect/capabilities/<name>.*`;
- `template:add-workflow` emits graph JSON plus Confect `start/status/control`
  spec/impl/tests and a plain Convex durable replay handler;
- `template:add-agent` emits agent spec/impl/tool grants/tests and defaults to
  web-only exposure;
- generated slices must run `pnpm confect:codegen`, `pnpm confect:manifest`, and
  focused tests.

- [ ] **Step 3: Update security docs**

Add a section that API/CLI/MCP calls do not trust caller-supplied workspace
identity. They resolve a Principal and workspace access server-side, use typed
public errors, and redact provider/config/internal defects.

- [ ] **Step 4: Mark phases complete in status doc**

In `docs/template/effectification-status.md`, change every completed phase from
`planned` to `complete` and add verification rows with exact commands and
results.

- [ ] **Step 5: Run doc gates**

Run:

```bash
rtk host-test-slot --class focused pnpm check:docs-freshness
rtk host-test-slot --class focused pnpm check:confect-contracts
rtk host-test-slot --class focused pnpm check:headless-surface-contract
rtk host-test-slot --class focused pnpm check:generators
```

Expected: all commands exit `0`. If `check:generators` fails only because Convex
codegen needs a live deployment connection, record the exact failure in
`docs/template/effectification-status.md`, run the focused generator tests and
non-live generated-file checks, and do not claim the full generator gate passed.

- [ ] **Step 6: Commit**

Run:

```bash
rtk git add docs/template docs/rule-coverage.md && rtk git commit -m "docs: align template contract model"
```

## Task 33: Run Phase-Level Focused Verification

**Files:**

- Modify only if failures reveal code/docs mistakes from previous tasks.

- [ ] **Step 1: Run backend focused gates**

Run:

```bash
rtk host-test-slot --class focused pnpm --dir packages/convex test
rtk pnpm --dir packages/convex typecheck
rtk pnpm confect:codegen
rtk pnpm confect:manifest
rtk git diff --exit-code packages/convex/confect/_generated packages/convex/convex/_generated packages/convex/convex/schema.ts packages/template-core/src/generated/confectManifest.ts
```

Expected: all commands exit `0`; generated files have no drift after
codegen/manifest generation.

- [ ] **Step 2: Run tooling and app focused gates**

Run:

```bash
rtk host-test-slot --class focused pnpm --dir tooling/confect-manifest test
rtk host-test-slot --class focused pnpm --dir tooling/generators test
rtk host-test-slot --class focused pnpm --dir tooling/workflow test
rtk host-test-slot --class focused pnpm --dir tooling/quality test
rtk host-test-slot --class focused pnpm --dir apps/cli test
rtk host-test-slot --class focused pnpm --dir apps/web test
rtk host-test-slot --class focused pnpm --dir packages/editor-core test
rtk host-test-slot --class focused pnpm --dir packages/editor-react test
```

Expected: all commands exit `0`.

- [ ] **Step 3: Run contract and surface checks**

Run:

```bash
rtk host-test-slot --class focused pnpm check:confect-contracts
rtk host-test-slot --class focused pnpm check:confect-compat
rtk host-test-slot --class focused pnpm check:headless-surface-contract
rtk host-test-slot --class focused pnpm check:generators
rtk host-test-slot --class focused pnpm check:generated-files
rtk host-test-slot --class focused pnpm check:layer-boundaries
```

Expected: all commands exit `0`. If `check:generators` fails only because Convex
codegen needs a live deployment connection, record the exact failure in
`docs/template/effectification-status.md`, run all listed non-live focused
checks, and mark the generator gate as environmentally blocked rather than
passing.

- [ ] **Step 4: Commit verification fixes if needed**

If any command required a code/doc fix, commit the fix:

```bash
rtk git status --short
```

Stage only the files shown by `rtk git status --short` that were changed to fix
the verification failure, then commit:

```bash
rtk git commit -m "fix: satisfy effectified contract gates"
```

If no files changed, do not create an empty commit.

## Task 34: Run Full Verification Through The Host Semaphore

**Files:**

- Modify only if verification exposes a real defect.

- [ ] **Step 1: Run the full local gate**

Run:

```bash
rtk host-test-slot --class full pnpm verify
```

Expected: command exits `0`. If the gate fails on `check:generators` because
Convex deployment codegen needs a live deployment connection, record the exact
failure in `docs/template/effectification-status.md`, run the equivalent focused
gates that do not require live deployment, and do not claim full verification
passed.

- [ ] **Step 2: Capture final status**

Run:

```bash
rtk git status --short
rtk git log --oneline -10
```

Expected: only intentional changes remain uncommitted. The last commits should
correspond to this plan's task boundaries.

- [ ] **Step 3: Update verification log**

Append a row to `docs/template/effectification-status.md`:

```markdown
| 2026-07-03 | G | `host-test-slot --class full pnpm verify` | pass |
```

Use the real date and command result from the run.

- [ ] **Step 4: Commit final log**

Run:

```bash
rtk git add docs/template/effectification-status.md && rtk git commit -m "docs: record effectification verification"
```

## Task 35: Final Review Checklist

**Files:**

- Modify only if checklist findings expose mistakes.

- [ ] **Step 1: Contract source-of-truth check**

Run:

```bash
rtk rg -n "templateRegistry|shared template registry|canned" packages apps tooling docs
```

Expected: no runtime headless projection imports `templateRegistry`. Historical
docs may mention it only as removed or legacy.

- [ ] **Step 2: Typed error check**

Run:

```bash
rtk rg -n "FunctionSpec\\.public(Query|Mutation|Action)\\(" packages/convex/confect
rtk rg -n "error: \\(\\) =>" packages/convex/confect
```

Expected: every public Confect function has a declared error schema or is listed
in `docs/template/effectification-status.md` with a reason and a next task.

- [ ] **Step 3: Time determinism check**

Run:

```bash
rtk rg -n "Date\\.now\\(|Math\\.random\\(|crypto\\.randomUUID\\(" packages/convex/confect
```

Expected: no persisted Confect impl uses ambient time/random. Deterministic test
fixtures may use constants.

- [ ] **Step 4: Generated drift check**

Run:

```bash
rtk pnpm confect:codegen
rtk pnpm confect:manifest
rtk git diff --exit-code packages/convex/confect/_generated packages/convex/convex/_generated packages/convex/convex/schema.ts packages/template-core/src/generated/confectManifest.ts
```

Expected: exit `0`.

- [ ] **Step 5: Editor substrate check**

Run:

```bash
rtk node - <<'NODE'
const fs = require("node:fs");
const manifests = Object.fromEntries(
  [
    "packages/convex/package.json",
    "apps/web/package.json",
    "packages/editor-react/package.json",
    "tooling/effectified-api-proof/package.json",
  ].map((file) => [file, JSON.parse(fs.readFileSync(file, "utf8"))]),
);
const depsFor = (file) => ({
  ...(manifests[file].dependencies ?? {}),
  ...(manifests[file].devDependencies ?? {}),
});
const selected = {
  blocknoteCore: depsFor("packages/convex/package.json")["@blocknote/core"],
  prosemirrorSync:
    depsFor("packages/convex/package.json")["@convex-dev/prosemirror-sync"],
  tiptapPm: depsFor("packages/convex/package.json")["@tiptap/pm"],
};
for (const [name, version] of Object.entries(selected)) {
  if (typeof version !== "string") throw new Error(`Missing selected editor pin: ${name}`);
}
const expectedByPackage = {
  "packages/convex/package.json": [
    "@blocknote/core",
    "@convex-dev/prosemirror-sync",
    "@tiptap/core",
    "@tiptap/pm",
  ],
  "apps/web/package.json": [
    "@blocknote/core",
    "@blocknote/react",
    "@convex-dev/prosemirror-sync",
    "@tiptap/core",
    "@tiptap/pm",
    "decode-named-character-reference",
  ],
  "packages/editor-react/package.json": [
    "@blocknote/core",
    "@blocknote/react",
    "@convex-dev/prosemirror-sync",
    "@tiptap/core",
    "@tiptap/pm",
    "decode-named-character-reference",
  ],
  "tooling/effectified-api-proof/package.json": [
    "@blocknote/core",
    "@convex-dev/prosemirror-sync",
    "@tiptap/core",
    "@tiptap/pm",
    "decode-named-character-reference",
  ],
};
for (const [file, deps] of Object.entries(expectedByPackage)) {
  const manifestDeps = depsFor(file);
  for (const dep of deps) {
    if (manifestDeps[dep] === undefined) {
      throw new Error(`Missing ${dep} from ${file}`);
    }
  }
}
const allDeps = Object.values(manifests)
  .map((manifest) => JSON.stringify({ dependencies: manifest.dependencies, devDependencies: manifest.devDependencies }))
  .join("\n");
const stale = [
  '"@blocknote/core": "0.51.2"',
  '"@convex-dev/prosemirror-sync": "0.2.4"',
  '"@tiptap/pm": "3.27.0"',
];
for (const needle of stale) {
  if (allDeps.includes(needle)) throw new Error(`Found stale editor pin: ${needle}`);
}
NODE
rtk host-test-slot --class focused pnpm --dir packages/convex test editor
rtk host-test-slot --class focused pnpm --dir packages/editor-core test
rtk host-test-slot --class focused pnpm --dir packages/editor-react test
```

Expected: selected exact pins are present consistently across the manifests that
import them, known stale pins are absent, and editor tests exit `0`. If a newer
compatible package family was deliberately selected in Task 27, this check
should pass without rewriting the hardcoded expected versions.

- [ ] **Step 6: Prepare final implementation note**

Create a final note in the PR description with:

- migrated contract groups;
- remaining contract groups not yet using the builder;
- verification commands with pass/fail status;
- any broad gate that could not run and the exact environmental reason;
- links to Effect/Confect docs used for implementation decisions.

Do not claim completion until Task 34 and this checklist have fresh passing
evidence or explicit documented failures.
