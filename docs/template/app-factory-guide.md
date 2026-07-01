# App Factory Guide

The app factory flow creates a client-specific app from this private template
without copying project-specific business logic into the core framework.

## Factory Principles

- Start from fake providers and synthetic demo data.
- Add client domain nouns through generators.
- Keep Confect specs, frontend adapters, headless registry entries, docs, and
  tests together.
- Promote runtime-authored capabilities to generated source when compile-time
  guarantees matter.
- Keep private client packages separate from the template core.

## Default Flow

1. Run `pnpm template:init -- --name "Client Brain" --write`.
2. Review and edit `template-instance.json`.
3. Run `pnpm template:doctor -- --mode fake`.
4. Add a first capability with
   `pnpm template:add-capability -- --name summarizeSource --write`.
5. Add a first workflow with
   `pnpm template:add-workflow -- --name sourceGroundedPlan --write`.
6. Add domain modules with `template:add-client-domain`.
7. Add capabilities, workflows, agents, Brain schemas, API surfaces, source
   types, notifications, admin surfaces, and data lifecycle resources through
   the matching generators.
8. Run focused verification for each generated change.
9. Run full verification before a client handoff.

## Client Forks

Client forks should consume template releases, not copy random files from the
template main branch. Use `template:upgrade` after Task 21 lands to compare a
client fork against a template release and list migrations, env changes,
contract diffs, and manual review items.

## Instance Doctor

`template:doctor` verifies the generated instance file has core modules,
provider posture, and fake-mode readiness. Fake mode must not require live
secrets. Live mode reports provider warnings until WorkOS, Convex, PostHog,
Dodo, email, LLM, and storage providers are configured.
