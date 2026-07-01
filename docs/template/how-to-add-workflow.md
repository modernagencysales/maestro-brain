# How To Add A Workflow

Generator after Task 16:

```bash
pnpm template:add-workflow -- --name sourceToBrief
```

## Files Created

- Confect workflow spec and impl.
- Durable graph schema or graph fixture.
- Web adapter and workflow UI entry.
- Headless registry entry when exposed.
- Tests, docs, audit metadata, and migration note when durable data changes.

## Tests

- graph validation;
- kickoff auth;
- policy snapshot;
- capability-step composition;
- durable replay;
- retry and idempotency;
- schedule and missed-run policy;
- run-observability ledger.

## Gates

- `pnpm --dir packages/convex test workflows`
- `pnpm --dir apps/web test src/features/workflows`
- `pnpm check:workflow-graph-boundary`
- `pnpm check:confect-contracts`
