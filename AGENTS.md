# Agent Instructions

This repo is a private internal template for custom AI brain and workflow apps.
Treat it as product infrastructure: preserve the generic framework, avoid
project-specific business logic, and keep the repo easy for future agents to
inspect and extend.

## Layer Law

```text
web routes -> screens -> features -> blocks -> Notion Kit
client hooks -> @confect/react refs -> Confect specs -> Convex functions
agents -> workflows -> capabilities -> domain/checks -> schema
API/CLI/MCP -> headless registry -> same capabilities/workflows as web
storage/notifications/observability -> Effect services -> provider adapters
admin/support/privacy -> audited capabilities -> narrow operator surfaces
```

Do not skip layers for convenience. If a change feels easier by importing across
layers, add the missing boundary instead.

## Confect And Effect Rules

- Before non-trivial Effect or Confect work, read
  `agent-patterns/effect-confect.md`.
- Durable Convex tables live under `packages/convex/confect/tables/*` and use
  Effect schemas.
- Public, internal, and HTTP functions use Confect specs/impls with typed args,
  returns, and expected errors.
- Plain Convex functions required by Convex components are registered in the
  Confect spec/impl tree.
- Specs import plain Convex functions with `import type`; impls import runtime
  function values.
- Use generated Confect refs and generated services. Do not duplicate business
  logic in web, API, CLI, or MCP surfaces.
- Pin `@confect/*`, `effect`, and companion `@effect/*` packages as a tested
  compatibility set.
- Do not edit generated Confect or Convex files by hand.

## Frontend Rules

- Keep reusable UI in blocks and package UI primitives.
- Use Notion Kit primitives when they cover the need.
- Feature components may use feature adapters; blocks may not import Convex,
  Confect refs, route modules, provider SDKs, or workspace auth internals.
- React Flow belongs in workflow UI and workflow feature surfaces only.
- Durable workflow graph validation and execution must not import React Flow.

## Workflow, Capability, And Agent Rules

- Capabilities authenticate, validate, delegate to domain/repo/services, and
  return typed results.
- Workflows compose capabilities and do not call provider adapters directly.
- Agents are nondeterministic actors with explicit tool grants. Agents start
  workflows or call capabilities; they do not call repos or adapters directly.
- Runtime-authored capabilities are data, not arbitrary code. Promotion to
  generated Confect source is the compile-time safety path.

## Testing Doctrine

- New behavior needs tests before implementation.
- Use focused tests for adapters, reducers, schemas, and gates.
- Use generated Confect refs in Confect tests.
- Broad local test gates must use:

```bash
host-test-slot --class full pnpm test
host-test-slot --class full pnpm verify
```

## Provider And Secret Boundary

- Fake/local providers are the default.
- Live provider SDK imports stay inside adapter packages.
- Do not expose server secrets to web code.
- Do not log raw provider payloads, webhook bodies, tokens, API keys, or support
  artifacts.
- Provider docs name required secret names, never secret values.

## CI Verdict Retrieval

Use Buildkite, GitHub, and local scripts as the source of truth. If an AI gate
or CI context is unavailable, report the missing context explicitly instead of
assuming success.

## Repo Navigation

- `apps/web`: reference app.
- `apps/cli`: headless CLI.
- `apps/voice-relay`: optional voice/capture relay.
- `packages/convex`: Confect/Convex backend.
- `packages/ui`: UI primitives and blocks.
- `packages/workflow-ui`: React Flow workflow builder.
- `packages/template-core`: shared template contracts.
- `packages/integrations`: provider interfaces and adapters.
- `tooling/quality`: gates and CI helpers.
- `tooling/generators`: app-factory generators.
- `docs/template`: operating docs and playbooks.
- `repos/effect`: vendored Effect source, read-only reference material.
- `repos/confect`: vendored Confect source, read-only reference material.

## Vendored Repositories

This project vendors external repositories under `repos/`.

- Use vendored repositories as read-only reference material when working with
  related libraries.
- Prefer examples and patterns from vendored source and tests over generated
  guesses or web snippets.
- Do not edit files under `repos/` unless explicitly asked to update a vendored
  subtree.
- Do not import from `repos/`; application code imports from normal package
  dependencies.
- When writing Effect code, inspect `repos/effect/AGENTS.md` and relevant tests
  under `repos/effect/packages/effect/test/`.
- When writing Confect code, inspect `repos/confect/CLAUDE.md`,
  `repos/confect/apps/example/confect/`, and relevant tests under
  `repos/confect/packages/*/test/`.

## Playbook Index

- [Add a workflow](docs/template/how-to-add-workflow.md)
- [Add a capability](docs/template/how-to-add-capability.md)
- [Add an agent](docs/template/how-to-add-agent.md)
- [Add a Brain schema](docs/template/how-to-add-brain-schema.md)
- [Add a source type](docs/template/how-to-add-source-type.md)
- [Add a notification](docs/template/how-to-add-notification.md)
- [Add an admin surface](docs/template/how-to-add-admin-surface.md)
- [Add a data lifecycle resource](docs/template/how-to-add-data-lifecycle-resource.md)
- [Add a frontend route](docs/template/how-to-add-frontend-route.md)
- [Add a private package](docs/template/how-to-add-private-package.md)

## Rule Ambiguity

When rules conflict, prefer tenant safety, generated contracts, typed errors,
redaction, and small focused changes. If still ambiguous, write the assumption
in the PR description or implementation note and ask for rule review.
