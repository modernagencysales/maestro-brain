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

After the web app lands, run:

```bash
pnpm --dir apps/web dev
```

## 2. Inspect The Product Surfaces

Open the reference app and inspect:

- Home
- Brain
- Workflow builder
- API docs
- Admin/Support
- Data Map
- Health

Each surface should show generic AI operations behavior and synthetic data.

## 3. Run One Workflow

After workflow execution lands, start the same workflow through:

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

After Task 4 lands, use:

```bash
host-test-slot --class full pnpm verify
```
