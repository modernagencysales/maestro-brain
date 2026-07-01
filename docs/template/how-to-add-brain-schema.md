# How To Add A Brain Schema

Generator after Task 16:

```bash
pnpm template:add-brain-schema -- --name customerBrief
```

## Files Created

- Effect schema.
- Confect table or group updates.
- Source Set or Evidence View projection when needed.
- Context pack mapping.
- Trust Receipt metadata.
- Tests, docs, and migration note for durable changes.

## Tests

- markdown/link import;
- Source Set resolution;
- Evidence Snapshot;
- Evidence View;
- freshness decay;
- context pack;
- quote/source grounding;
- export and delete.

## Gates

- `pnpm --dir packages/convex test brain`
- `pnpm check:schema-migration-notes`
- `pnpm check:confect-contracts`
