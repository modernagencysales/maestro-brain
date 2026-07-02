## Intention

<!-- ONE intention. If you can't say it in one sentence, split the PR. -->

## What changed

-

## Verification (paste evidence — do not assert)

```
# output of: just verify (or the focused gate chain for this change)
```

## Checklist

- [ ] One intention; small, reviewable diff
- [ ] Scaffolded via `pnpm template:*` generators where one exists (no
      hand-rolled registrations)
- [ ] Typed args AND returns; auth/workspace gate is the first statement in
      capability handlers
- [ ] Tests are behavioral (no source-text grep); co-located with the change
- [ ] No suppressions added (`eslint-disable` / `ts-expect-error`)
- [ ] Did NOT touch a gate file to make red turn green
- [ ] Docs updated when a subsystem changes status (real/fake/seam/planned)

> Draft first. Never self-merge. A green `just verify` is the definition of
> ready for CI.
