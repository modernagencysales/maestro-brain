# How To Add A Notification

Use the notification generator:

```bash
pnpm template:add-notification -- --name workflowCompleted
```

## Files Created

- Notification schema.
- Provider dispatch capability.
- Fake/test provider fixture.
- Web notification surface using `TemplateNotificationCenter`.
- Email or webhook mapping when enabled.
- Tests and docs.

The template already ships the fake-safe center foundation:
`packages/notifications` owns notification records, in-app/email/digest
preferences, read-state planning, unread counts, and channel filtering.
`/notifications` renders a reference inbox without requiring live provider
credentials. Generated notifications should extend those contracts rather than
creating a second inbox model.

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
