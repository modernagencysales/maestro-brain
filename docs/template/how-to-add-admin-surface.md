# How To Add An Admin Surface

Use the admin surface generator:

```bash
pnpm template:add-admin-surface -- --name providerHealth
```

## Files Created

- Admin/support Confect functions.
- Web admin feature.
- Audit event metadata.
- Role policy.
- Tests and docs.

## Tests

- admin allowed;
- support scoped access;
- normal user denial;
- cross-workspace denial;
- audit emitted;
- private data redacted.

## Gates

- `pnpm --dir packages/convex test admin`
- `pnpm --dir apps/web test src/features/admin-support`
- `pnpm check:tenant-identity-boundary`
