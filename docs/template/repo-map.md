# Repo Map

## Top Level

- `apps/`: runnable applications.
- `packages/`: reusable framework packages.
- `tooling/`: gates, generators, release helpers, evals, and workflow tooling.
- `examples/`: reviewer-safe synthetic example apps and seed data.
- `docs/`: architecture, operations, and playbooks.
- `docs/template/investor-reviewer-packet.md`: first-stop technical diligence
  packet for investors and review agents.
- `agent-patterns/`: future local references for Effect, Confect, and workflow
  graph idioms.
- `repos/`: future vendored read-only source references for Effect and Confect.

## Apps

- `apps/web`: the hostable Vite reference workspace app.
- `apps/cli`: typed CLI projection over the shared headless registry.
- `apps/voice-relay`: optional capture/voice relay app.

## Packages

- `packages/convex`: Confect specs/impls, Convex components, schema, and tests.
- `packages/ui`: Notion-style app shell, blocks, layout primitives, and
  settings-ready controls.
- `packages/workflow-ui`: React Flow graph editor primitive and future command
  reducers.
- `packages/template-core`: shared template registry, workflow/capability/agent
  types, policies, and reviewer-safe fixtures.
- `packages/integrations`: Effect service interfaces and provider adapters.
- `packages/notifications`: notification provider boundary.
- `packages/storage`: asset storage provider boundary.
- `packages/observability`: event contracts, logs, SLOs, and telemetry helpers.
- `packages/search`: optional search/vector provider boundary.

## Tooling

- `tooling/quality`: deterministic gates and AI gate wrappers.
- `tooling/workflow`: headless operation projection, CLI/MCP/API metadata,
  OpenAPI generation, and workflow helpers.
- `tooling/generators`: template init, add-* generators, doctor, and upgrade.
- `tooling/evals`: prompt and source-grounding evaluation fixtures.
- `tooling/release`: deploy, smoke, rollback, and backup/restore helpers.
- `tooling/pr-backlog`: PR sweep and backlog tooling.

## Generated Directories

- `packages/convex/confect/_generated`: Confect generated refs, schemas, and
  services. Never edit directly.
- `packages/convex/convex/_generated`: Convex generated API files. Never edit
  directly.
- `apps/web/src/routeTree.gen.ts`: generated route tree once TanStack routes
  land. Never edit directly.

## Planned Routes

- `/`: Home.
- `/brain`: Brain pages, sources, context packs, evidence, and trust receipts.
- `/workflows`: workflow builder, run kickoff, and run inspection.
- `/capabilities`: capability catalog and runtime-authored definitions.
- `/agents`: agent seats, tool grants, approvals, and conversations.
- `/runs`: workflow and agent run history.
- `/documents`: generated and reviewed documents.
- `/sources`: source intake and upload state.
- `/integrations`: provider health and configuration.
- `/api`: API docs and key management.
- `/onboarding`: first-run setup.
- `/data-map`: retention, export, delete, and processor inventory.
- `/notifications`: notification center.
- `/settings`: workspace, users, auth, and Notion settings.
- `/billing`: package, entitlement, credits, checkout, and portal.
- `/analytics`: product and workflow analytics.
- `/health`: system and provider health.
- `/admin`: support, audit, data lifecycle, and operator tools.
