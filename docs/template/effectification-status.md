# Effectification Status

This document tracks the migration from a partially Confect-shaped template to
an Effect/Confect-rooted template where schemas, typed errors, tenancy, headless
surfaces, generators, and optional editor sync are derived from the same
contract family.

## Current Verified Baseline

- Confect packages are pinned to `9.1.5`; Effect is pinned to `3.21.4`.
- Confect v9 is the required baseline because its per-group generated registries
  keep Convex cold-start module evaluation proportional to the invoked group,
  not to the whole project.
- Durable tables live under `packages/convex/confect/tables/*`.
- Confect specs and impls exist for access, Brain pages, capabilities, jobs,
  ops, agents, auth, demo, editor sync, workflow contracts, and manifest
  surfaces.
- Public Confect-provenance specs declare typed errors, and public error
  families use `Schema.TaggedError` classes.
- Workspace-sensitive public paths resolve a Principal and workspace access
  server-side instead of trusting caller-supplied workspace identity.
- Generated Confect refs, schema, Convex schema, and registered function files
  exist under `packages/convex/confect/_generated/*`.
- Runtime API, CLI, and MCP projection now derives from the generated Confect
  manifest and explicit generated ref mappings instead of the canned
  `templateRegistry`.
- OpenAPI and MCP schemas are generated from the spec-bound Effect schema
  registry with `effect/JSONSchema`.
- Generator output for capabilities, workflows, and agents emits
  production-shaped Confect slices with focused tests and docs.
- The optional BlockNote/Tiptap/ProseMirror substrate is exact-pinned and
  wrapped behind generic editor packages and backend sync seams.
- `check:confect-contracts` and `check:headless-surface-contract` include
  semantic checks for typed public errors, generated files, generated ref
  parity, idempotency proof, and canned-success regressions.

## Known Gaps Remaining

- The template is a verified starter baseline, not a finished generic SaaS
  product. The exhaustive porting backlog still tracks optional or
  client-specific primitives such as full billing lifecycle, notification
  center, provider-specific deploy hardening, production retention jobs, and
  every future product surface.
- Some Confect groups still predate the spec-bound capability/workflow builder
  helpers. They are valid Confect groups, but they do not all emit manifest
  metadata until migrated.
- PostHog failure capture currently covers selected mutation/action paths; query
  failure telemetry still needs a future durable event path.
- `brain/pages.createMarkdown` is the first Confect mutation wrapped with
  backend PostHog failure capture.
- Remaining Confect groups are still unwrapped pending rollout/factory support.
- Access lifecycle planners emit audit-event values, including invitation
  lifecycle events, but tenancy mutations do not yet persist them because this
  template slice does not include a durable access-audit sink. Forks that expose
  invite/role administration in production must wire those `plan.events` values
  into an audit table or external audit stream.
- Generated workflow graph data is emitted as JSON-safe TypeScript constants so
  it can be typechecked with the workflow schemas; consumers must still treat
  React Flow state as a projection, not durable source.
- Provisioned `@confect/test` coverage exists for selected contract paths. Full
  provisioned coverage for storage, scheduling, Node actions, and every public
  group remains a follow-up for forks with live Convex deployment codegen.
- Editor sync remains optional. Forks must keep `checkRead` and `checkWrite`
  tied to server-side workspace access before exposing collaborative editing in
  production.
- Editor sync wraps plain Convex ProseMirror component functions. Access denials
  are encoded as tagged `EditorSyncAccessDenied` `ConvexError` payloads, but
  Confect `convexPublic*` wrappers do not currently expose an `error` schema
  slot for those component functions.
- Frontend UX essentials now include route focus, hosted axe smoke, dialog focus
  trap, route announcements, live-region announcements, root route
  pending/error/not-found states, offline/degraded network retry affordances,
  runtime reduced-motion gating for workflow edge animation, toast primitives,
  and onboarding continuation feedback through `TemplateToastProvider`.
  Remaining product-surface work is adoption: wire future modals/popovers into
  `TemplateDialog` and wire real mutation success/error paths into
  `TemplateToastProvider`.

## Starter Readiness Read

As of 2026-07-05, the current `main` branch is a good SaaS-starter baseline for
new client work: it has the Effect/Confect contract spine, typed error doctrine,
headless surface generation, guarded CI, app shell, Notion Kit-based frontend,
generator scaffolds, and core UX/a11y primitives. It is not yet a complete
generic SaaS product. Treat the remaining backlog as selectable product
acceleration work, not as proof that the existing starter baseline is fake.

The remaining cross-cutting starter improvements are:

1. Adopt the shared dialog and toast primitives in each real product surface as
   those surfaces gain mutations, modals, popovers, and destructive flows.
2. Keep [template-defaults.md](./template-defaults.md) current when billing,
   notification center, retention jobs, or deploy promotion move between
   template defaults and client-fork extension paths.

## Generated Artifact Ownership

These generated artifacts exist today. Never edit them by hand:

- `packages/convex/confect/_generated/*` — generated by
  `rtk pnpm confect:codegen`.
- `packages/convex/convex/_generated/*` — generated by
  `rtk pnpm confect:codegen` and Convex codegen.
- `packages/convex/convex/schema.ts` — generated schema re-export; regenerated
  by Confect/Convex codegen.
- `packages/template-core/src/generated/confectManifest.ts` — generated by
  `rtk pnpm confect:manifest`; contains serialized manifest metadata and
  generated JSON schemas.
- `apps/web/src/routeTree.gen.ts` — generated by TanStack Router tooling.

Each implementation task that changes a generator input must run the generator,
inspect the generated diff, and prove no stale generated output remains.

## Phase Status

| Phase | Scope                                                             | Status   |
| ----- | ----------------------------------------------------------------- | -------- |
| 0     | Preflight API proofs and review-amendment guardrails              | complete |
| A     | Docs, baseline, executable Confect tests                          | complete |
| B     | Tenancy, typed errors, and Clock-backed persisted paths           | complete |
| C     | Capability builder, manifest, executor, and generated projections | complete |
| D     | Generators and semantic gates                                     | complete |
| E     | Effect services, frontend adapters, and runtime ergonomics        | complete |
| F     | Exact-pinned editor substrate                                     | complete |
| G     | Final docs, broad verification, and cleanup                       | complete |

## Verification Log

Add one row per completed phase or reconciliation gate.

| Date       | Phase       | Command                                                                                | Result                                                                                                                 |
| ---------- | ----------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| 2026-07-04 | B / Task 11 | `rtk rg -n "Date\\.now\\(" packages/convex/confect`                                    | Fixed wall-clock `Date.now()` usage was removed from persisted impl paths; demo fixtures still use relative durations. |
| 2026-07-04 | F / Task 31 | `rtk pnpm confect:manifest`                                                            | pass                                                                                                                   |
| 2026-07-04 | F / Task 31 | `rtk host-test-slot --class focused pnpm check:confect-manifest`                       | pass                                                                                                                   |
| 2026-07-04 | F / Task 31 | `rtk host-test-slot --class focused pnpm --dir packages/convex test http-docs.test.ts` | pass, 12 tests                                                                                                         |
| 2026-07-04 | F / Task 31 | `rtk host-test-slot --class focused pnpm --dir tooling/workflow test`                  | pass, 10 tests                                                                                                         |
| 2026-07-04 | F / Task 31 | `rtk host-test-slot --class focused pnpm typecheck`                                    | pass                                                                                                                   |
| 2026-07-04 | G / Task 32 | `rtk host-test-slot --class focused pnpm check:docs-freshness`                         | pass, pin-only                                                                                                         |
| 2026-07-04 | G / Task 32 | `rtk host-test-slot --class focused pnpm check:confect-contracts`                      | pass, pin-only and semantic                                                                                            |
| 2026-07-04 | G / Task 32 | `rtk host-test-slot --class focused pnpm check:headless-surface-contract`              | pass                                                                                                                   |
| 2026-07-04 | G / Task 32 | `rtk host-test-slot --class focused pnpm check:generators`                             | pass, pin-only                                                                                                         |
| 2026-07-04 | G / Task 34 | `rtk host-test-slot --class full pnpm verify`                                          | pass                                                                                                                   |
| 2026-07-04 | G / Task 35 | `rtk gh pr checks 6`                                                                   | pass, 9 hosted checks                                                                                                  |
| 2026-07-04 | G / Task 35 | `rtk headless-bws-env exec bk build view -p mas/maestro-template 88 --no-pager --text` | pass: phase-1 deterministic gates, taste, and contract review                                                          |
