# How To Add A Workflow

Dry-run a generated workflow:

```bash
pnpm template:add-workflow -- --name sourceToBrief
```

Write the generated files:

```bash
pnpm template:add-workflow -- --name sourceToBrief --description "Turns approved sources into a reviewed brief." --write
```

Promote reviewed files into production-target workflow paths:

```bash
pnpm template:promote-workflow -- --name sourceToBrief --description "Turns approved sources into a reviewed brief." --write
```

## Files Created

- React Flow friendly durable graph seed under `generated/workflows/<name>/`.
- Workflow metadata for web, CLI, and MCP exposure.
- Graph integrity test scaffold.
- README with follow-up steps for Confect save/validate/run functions.

The generator intentionally writes reviewable graph artifacts first. After
review, `template:promote-workflow` writes production-target Confect run
functions and a durable graph seed under
`packages/convex/confect/workflows/<name>/`. Add the promoted group to the
Confect spec tree, replace placeholder capability refs, then wire save,
validate, run, replay, approval, and receipt behavior through Confect functions.

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
