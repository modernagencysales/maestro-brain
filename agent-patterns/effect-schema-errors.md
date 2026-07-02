# Effect Schema And Error Patterns

## Read Order

1. `repos/effect/packages/effect/test/Schema/Class/TaggedError.test.ts`
2. `repos/effect/packages/effect/src/Schema.ts`
3. `packages/convex/confect/shared/errors.ts`
4. `packages/convex/confect/errors.ts`

## Local Template Rules

- Use `Schema.Struct`, `Schema.Literal`, `Schema.Union`, and branded schemas for
  boundary data.
- Use `Schema.TaggedError` for public failures that cross Confect or HTTP
  boundaries.
- Keep error codes closed and stable; add new codes deliberately.
- Redact unknown errors before returning them through API, CLI, MCP, or UI
  surfaces.

## Good Examples

- `packages/convex/confect/shared/errors.ts`
- `packages/convex/confect/shared/env.ts`
- `packages/convex/confect/capabilities/sourceGroundedBrief.spec.ts`

## Things To Avoid

- Returning raw `Error.message` from provider SDKs.
- Using stringly typed error names that are not in the closed catalog.
- Treating parse failures as successful empty states.

## Verification Commands

```bash
pnpm --dir packages/convex test shared-errors
pnpm --dir packages/convex test source-grounded-brief
pnpm check:confect-contracts
```
