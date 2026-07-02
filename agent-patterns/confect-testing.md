# Confect Testing Patterns

## Read Order

1. `repos/confect/apps/example/**/__tests__`
2. `packages/convex/test/confect-contracts.test.ts`
3. Focused tests under `packages/convex/test/*.test.ts`

## Local Template Rules

- Write pure domain tests before wiring Confect handlers where possible.
- Test typed success and typed failure paths.
- Keep fake-mode provider tests deterministic and secret-free.
- Run codegen before contract checks when specs or tables change.
- Prefer narrow focused tests while iterating, then run broader gates before
  commit.

## Good Examples

- `packages/convex/test/access-effective-role.test.ts`
- `packages/convex/test/source-grounded-brief.test.ts`
- `packages/convex/test/workflow-run.test.ts`
- `packages/convex/test/agent-runtime.test.ts`

## Things To Avoid

- Tests that assert only file existence for behavior-critical contracts.
- Snapshotting generated files as a substitute for contract tests.
- Live provider requirements in default CI.

## Verification Commands

```bash
pnpm confect:codegen
pnpm check:confect-contracts
pnpm --dir packages/convex test
pnpm check:generators
```
