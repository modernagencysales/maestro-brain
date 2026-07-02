# Phase 10 App Factory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use
> superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand blueprint packs, client intake wizard,
`template-instance.json`, generator contracts, handoff artifacts, release
artifacts, upgrade compatibility tests, and private-package promotion.

**Architecture:** Generators remain the app-factory control plane. Generated
client-specific code stays reviewable and promotable through Confect/Effect
contracts, not ad hoc edits.

**Tech Stack:** TypeScript generator tooling, Confect/Effect, TanStack Start,
Buildkite release tooling.

---

## Scope

Make the template faster to use for any custom AI/GTM implementation build.

## Files

- Modify: `tooling/generators/src/index.ts`
- Modify: `tooling/generators/src/index.test.ts`
- Create: `docs/template/client-intake-wizard.md`
- Modify: `docs/template/app-factory-guide.md`
- Modify: `docs/template/generator-output-contract.md`
- Modify: `docs/template/client-handoff-packet.md`
- Modify: `tooling/release/src/index.ts`
- Modify: `tooling/release/src/index.test.ts`

## Tests

- `pnpm --dir tooling/generators test`
- `pnpm --dir tooling/generators typecheck`
- `pnpm --dir tooling/release test`
- `pnpm check:generators`

## Acceptance Criteria

- Blueprint packs include source-grounded GTM brain, implementation consulting
  brain, internal ops agent workspace, and custom domain AI app.
- Client intake wizard produces a structured implementation brief.
- `template-instance.json` tracks app identity, modules, providers, env posture,
  secrets names, release state, and upgrade compatibility.
- Handoff packet includes real/fake/seam/planned labels.
- Private-package promotion requires contract review metadata.

## Migration And Provisioning Impact

No DB changes. Generated instance manifests may introduce new provider secret
names in docs only.

## Maturity Level

Advances L4 app factory leverage.

### Task 1: Instance Manifest Evolution

- [x] Add generator tests for manifest fields: modules, providers, environments,
      release state, upgrade compatibility, and private package metadata.
- [x] Update generator manifest creation.
- [x] Run focused generator tests.

### Task 2: Intake Wizard

- [x] Add tests for `template:intake` command output.
- [x] Implement command that writes `docs/template/generated/client-intake.md`
      and updates `template-instance.json`.
- [x] Document wizard questions in `client-intake-wizard.md`.
- [x] Run generator tests and `pnpm check:generators`.

### Task 3: Release And Upgrade Artifacts

- [x] Add release tooling tests for compatibility report and handoff artifact
      list.
- [x] Implement release report additions.
- [x] Update app factory, handoff, and generator contract docs.
- [x] Run release and generator tests.
- [x] Commit:

```bash
git add tooling/generators tooling/release docs/template
git commit -m "feat: expand app factory generators"
```
