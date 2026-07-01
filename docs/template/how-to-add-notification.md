# How To Add A Notification

Generator after Task 16:

```bash
pnpm template:add-notification -- --name workflowCompleted
```

## Files Created

- Notification schema.
- Provider dispatch capability.
- Fake/test provider fixture.
- Web notification surface.
- Email or webhook mapping when enabled.
- Tests and docs.

## Tests

- workspace scope;
- unread/read state;
- delivery fake;
- provider failure;
- suppression or preference handling;
- audit event when required.

## Gates

- `pnpm --dir packages/convex test notifications`
- `pnpm --dir packages/notifications test`
- `pnpm check:confect-contracts`
