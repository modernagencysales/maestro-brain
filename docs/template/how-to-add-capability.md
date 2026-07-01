# How To Add A Capability

Generator after Task 16:

```bash
pnpm template:add-capability -- --name summarizeSource
```

## Files Created

- Confect capability spec and impl.
- Typed args, returns, and errors.
- Capability catalog metadata.
- Fake fixtures and tests.
- Frontend adapter when user-facing.
- Headless registry entry when exposed.
- Docs and audit metadata.

## Tests

- happy path;
- unauthenticated;
- role denial;
- cross-workspace denial;
- invalid input;
- typed error;
- idempotency;
- side-effect blocking before provider calls.

## Gates

- `pnpm --dir packages/convex test capabilities`
- `pnpm check:confect-contracts`
- `pnpm check:headless-surface-contract` when exposed.
