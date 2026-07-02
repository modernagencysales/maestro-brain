# Confect HTTP And Scalar Patterns

## Read Order

1. `repos/confect/apps/example/confect/http.ts`
2. `repos/confect/packages/*` Scalar/OpenAPI examples
3. `packages/convex/confect/http.ts`
4. `packages/convex/test/http-docs.test.ts`

## Local Template Rules

- Keep HTTP routes thin; they adapt transport to typed Confect refs.
- Use the shared public error envelope for REST, CLI, and MCP surfaces.
- OpenAPI/Scalar docs must describe generated contracts, not handwritten drift.
- Fail closed on missing auth, invalid API key, and malformed input.

## Good Examples

- `packages/convex/confect/http.ts`
- `packages/convex/confect/headless/errorEnvelope.ts`
- `tooling/workflow/src/index.ts`

## Things To Avoid

- Route-local business logic.
- Separate REST-only validators that diverge from Confect specs.
- Public docs that imply live provider readiness before env setup is complete.

## Verification Commands

```bash
pnpm --dir packages/convex test http-docs
pnpm test:workflow
pnpm exec tsx apps/cli/src/index.ts api openapi
```
