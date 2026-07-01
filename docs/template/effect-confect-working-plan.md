# Effect And Confect Working Plan

This plan makes Effect and Confect practical for the template without creating
future repo pain. The goal is not to import from vendored source. The goal is to
give humans and coding agents local source-of-truth examples when translating
Maestro's plain Convex machinery into Confect/Effect.

## What Changed

The template vendors upstream source under `repos/`:

- `repos/effect` from `https://github.com/Effect-TS/effect.git`
- `repos/confect` from `https://github.com/rjdellecese/confect.git`

Both were added as squashed git subtrees. They behave like ordinary directories
for readers, but should be treated as read-only reference material.

## Why This Helps

Effect and Confect are powerful, but agents write better code when they can
inspect real source, tests, and example apps. Documentation tells us what an API
does; source and tests show how the maintainers expect it to be used.

For this template, the vendored repos support three recurring jobs:

1. Translate Maestro's plain Convex code into Confect specs, impls, and Effect
   services.
2. Create local pattern files before large backend ports.
3. Review agent-generated code against upstream idioms instead of guesses.

## Guardrails

- Do not import from `repos/*`.
- Do not edit `repos/*` except when intentionally updating a subtree.
- Do not let format, lint, typecheck, or workspace discovery process `repos/*`.
- Prefer local project rules over upstream repo contribution rules when writing
  application code.
- Prefer upstream source and tests over web snippets when an Effect/Confect API
  is unclear.

## Maintenance Commands

Update Effect:

```bash
git subtree pull \
  --prefix=repos/effect \
  https://github.com/Effect-TS/effect.git \
  main \
  --squash
```

Update Confect:

```bash
git subtree pull \
  --prefix=repos/confect \
  https://github.com/rjdellecese/confect.git \
  main \
  --squash
```

After either update, run:

```bash
pnpm check:format
pnpm lint
pnpm typecheck
pnpm build
```

## How To Use The Vendored Source

Before any non-trivial Effect/Confect implementation:

1. Read `agent-patterns/effect-confect.md`.
2. Search `repos/confect/apps/example/confect/` for a similar Confect shape.
3. Search `repos/confect/packages/*/test/` for codegen, spec, impl, client, or
   server behavior.
4. Search `repos/effect/packages/effect/test/` for Effect, Schema, Layer,
   Context, Config, or error behavior.
5. Write or update a small local pattern note if the subsystem is large enough
   that future agents will need the same discovery again.

## First Pattern Notes To Create

Create these before the corresponding porting slices:

1. `agent-patterns/confect-spec-impl.md` for tables, specs, impls, generated
   refs, plain Convex interop, and codegen failures.
2. `agent-patterns/effect-schema-errors.md` for `Schema.Struct`,
   `Schema.TaggedError`, decoding/encoding, and public error contracts.
3. `agent-patterns/effect-services-layers.md` for fake/test/live provider
   services, `Layer` wiring, and test substitution.
4. `agent-patterns/confect-http-scalar.md` for Effect HTTP APIs, Scalar docs,
   route registration, and typed HTTP errors.
5. `agent-patterns/confect-testing.md` for `@confect/test`, mock/local backend
   choices, and when a provisioned Convex deployment is required.

## Porting Order

Do not start with the largest workflow or agent runtime. Build confidence with a
thin but real vertical slice:

1. **Truthful docs and backlog hygiene**: port the backlog doc, add dependency
   ordering, add acceptance criteria, and reconcile docs that currently
   overclaim.
2. **Effect/Confect spine**: env access, crypto helpers, typed error catalog,
   clock/nonce seams, and tests.
3. **Tenancy minimum**: organizations, workspace membership, role lattice,
   server-derived access helpers, and action-side tenancy bridge.
4. **Provider gateway minimum**: LLM gateway with fake/test/live layers,
   kill-switch, rate-limit seam, spend estimate, and telemetry quarantine.
5. **Policy and prompt minimum**: policy table, resolver, prompt registry,
   pinned prompt snapshot, and XML user-input hardening.
6. **One real capability**: source-grounded summary or brief generator using the
   provider gateway and producing typed success/failure results.
7. **One workflow run**: graph metadata, run row, evidence snapshot, trust
   receipt, and CLI/API/MCP exposure.
8. **Agent shell**: typed tools, one bounded planner/research agent turn, and
   idempotent thread entrypoints.
9. **Frontend vertical**: WorkOS login seam, workspace bootstrap, active
   workspace, Brain source list, workflow run, and receipt page.
10. **Quality gates**: replace fake-stub gates with real tools as soon as they
    protect code that now exists.

## Acceptance Criteria For Each Port

Every Confect/Effect port should include:

- A local pattern reference or link to an existing one.
- Effect schemas for persisted and public data.
- Typed public errors.
- Fake/test/live service boundaries when providers are involved.
- Focused tests for pure helpers and Effect services.
- Confect contract/codegen verification when functions or tables change.
- Updated docs that state whether the subsystem is real, fake, seam, or planned.
- No imports from `repos/*`.

## Pain Avoidance

The main risks are repo weight, accidental editor imports, and noisy checks.
Mitigations are already in place:

- `.prettierignore` excludes `repos/`.
- `eslint.config.mjs` excludes `repos/`.
- `pnpm-workspace.yaml` only includes `apps/*`, `packages/*`, and `tooling/*`.
- `.vscode/settings.json` excludes `repos/` from search, watchers, and
  auto-imports.
- `AGENTS.md` tells agents to use `repos/` as read-only reference material.

## Current Open Questions

- Whether to also vendor Convex source or rely on official docs plus installed
  package types.
- Whether the template should track Effect v4 beta separately once Confect
  supports it.
- Whether Confect should be updated on a fixed cadence or only before major
  backend porting work.
