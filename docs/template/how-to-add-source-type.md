# How To Add A Source Type

Generator after Task 16:

```bash
pnpm template:add-source-type -- --name customerBrief
```

## Files Created

- Source intake schema.
- Normalizer.
- Storage policy.
- Brain ingestion mapping.
- Export/delete metadata.
- Tests and docs.

## Tests

- accepted and rejected content;
- provenance;
- workspace isolation;
- storage URL expiry;
- conversion status;
- Brain consumption.

## Gates

- `pnpm --dir packages/convex test source-intake-storage`
- `pnpm check:schema-migration-notes`
- `pnpm check:secret-canaries`
