# How To Add A Data Lifecycle Resource

Use the data lifecycle generator:

```bash
pnpm template:add-data-lifecycle-resource -- --name sourceArchive
```

## Files Created

- Resource metadata.
- Export manifest mapping.
- Delete handler or typed block reason.
- Data Map entry.
- Tests and docs.

## Tests

- export manifest includes allowed fields;
- delete removes or blocks correctly;
- provider storage mapping;
- audit event;
- workspace isolation.

## Gates

- `pnpm --dir packages/convex test dataLifecycle`
- `pnpm --dir apps/web test src/features/data-map`
- `pnpm check:schema-migration-notes`
