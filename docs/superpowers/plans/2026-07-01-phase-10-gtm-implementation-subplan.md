# Phase 10 GTM Implementation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional GTM implementation blueprint modules for accounts,
people, sources, enrichment adapters, CRM/drive/Notion seams, reporting
surfaces, and demo-safe fixtures.

**Architecture:** GTM modules are blueprint packs, not template-core
assumptions. Core primitives remain generic; GTM-specific schema and workflows
live under generated/private package boundaries until promoted.

**Tech Stack:** Confect, Effect Schema, generator tooling, provider adapter
seams, TanStack Start feature surfaces.

---

## Scope

Provide optional GTM implementation software starter modules for typical B2B
clients.

## Files

- Create: `examples/gtm-implementation/seed/accounts.json`
- Create: `examples/gtm-implementation/seed/people.json`
- Create: `examples/gtm-implementation/seed/sources.md`
- Create: `tooling/generators/src/blueprints/gtmImplementation.ts`
- Modify: `tooling/generators/src/index.ts`
- Modify: `tooling/generators/src/index.test.ts`
- Create: `docs/template/blueprints/gtm-implementation.md`
- Modify: `docs/template/blueprint-catalog.md`

## Tests

- `pnpm --dir tooling/generators test`
- `pnpm check:generators`
- `pnpm template:quickstart -- --blueprint gtm-implementation --name "GTM Brain"`

## Acceptance Criteria

- GTM blueprint is optional and clearly marked as a blueprint pack.
- Accounts and people fixtures are demo-safe and contain no real customer data.
- Connector seams for CRM, drive, and Notion are fake/test/live-ready
  descriptors, not live SDK requirements.
- Reporting surfaces are generated as feature stubs with clear promotion path.

## Migration And Provisioning Impact

No core DB changes. Generated GTM forks may create client-specific tables after
contract review.

## Maturity Level

Advances L4 GTM-specific app factory leverage.

### Task 1: Demo-Safe Fixtures

- [x] Create seed account, people, and source fixtures.
- [x] Add generator tests that assert fixture data uses `.example` domains and
      fake company names.
- [x] Run focused generator tests.

### Task 2: GTM Blueprint Pack

- [x] Implement `gtmImplementation.ts` blueprint descriptor.
- [x] Register blueprint in generator catalog without making it default.
- [x] Add quickstart tests for generated capabilities, workflows, and provider
      seam metadata.
- [x] Run `pnpm --dir tooling/generators test`.

### Task 3: Docs And Catalog

- [x] Add `docs/template/blueprints/gtm-implementation.md`.
- [x] Update `blueprint-catalog.md` and `app-factory-guide.md`.
- [x] Run `pnpm check:generators` and `pnpm check:format`.
- [x] Commit:

```bash
git add examples/gtm-implementation tooling/generators docs/template
git commit -m "feat: add optional gtm implementation blueprint"
```
