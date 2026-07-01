# Reviewer Guide

This guide is the 30-minute technical diligence path.

## 1. Run The Repo Locally

```bash
pnpm install
pnpm check:format
pnpm lint
pnpm typecheck
host-test-slot --class full pnpm test
pnpm build
```

Start the reference app:

```bash
pnpm --dir apps/web dev -- --port 5174
```

Open `http://127.0.0.1:5174/`. The first screen is the generic AI operations
workspace: Brain, workflows, capabilities, agents, integrations, headless
surfaces, and safety posture.

## 2. Inspect The Product Surfaces

Open the reference app and inspect:

- reusable app shell and navigation from `packages/ui`;
- React Flow workflow primitive from `packages/workflow-ui`;
- Brain/source/context/trust receipt model;
- capabilities, agents, and workflow composition model;
- API/CLI/MCP and provider adapter posture;
- safety model and generated contract checklist.

The app intentionally uses reviewer-safe synthetic data and fake/local provider
posture.

## 3. Run One Workflow

The current app shows the workflow authoring primitive. When execution surfaces
land, start the same workflow through:

- web workflow builder;
- CLI;
- MCP tool.

Inspect the run receipt, audit event, and Trust Receipt.

## 4. Inspect Confect

Open one Confect spec, its impl, and generated refs. Confirm args, returns, and
expected errors are Effect schemas and that callers use generated refs.

## 5. Inspect Operations

Read:

- [operations-runbook.md](./operations-runbook.md)
- [data-lifecycle.md](./data-lifecycle.md)
- [security.md](./security.md)

Confirm deploy, rollback, export/delete, and support access are documented.

## 6. Run Fast Verification

```bash
pnpm check:format && pnpm lint && pnpm typecheck && host-test-slot --class full pnpm test && pnpm build
```

For the full deterministic gate chain, use:

```bash
host-test-slot --class full pnpm verify
```
