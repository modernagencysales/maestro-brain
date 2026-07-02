# Confect Spec And Impl Patterns

## Read Order

1. `repos/confect/apps/example/confect/notes_and_random/notes.spec.ts`
2. `repos/confect/apps/example/confect/notes_and_random/notes.impl.ts`
3. `repos/confect/apps/example/confect/workpool.spec.ts`
4. Local examples under `packages/convex/confect/**/{*.spec.ts,*.impl.ts}`

## Local Template Rules

- Put public contract shape in `*.spec.ts`; put behavior in `*.impl.ts`.
- Use Effect Schema for args, returns, and expected public errors.
- Default-export a `GroupSpec` from the spec and a finalized `GroupImpl` from
  the impl.
- Keep plain Convex functions only where components require them; include them
  with `FunctionSpec.convex*` and type-only imports.
- Run `pnpm confect:codegen` after table, spec, or impl changes.

## Good Examples

- `packages/convex/confect/ops/knowledge.spec.ts`
- `packages/convex/confect/ops/knowledge.impl.ts`
- `packages/convex/confect/capabilities/sourceGroundedBrief.spec.ts`
- `packages/convex/confect/agents/assistant.spec.ts`

## Things To Avoid

- Runtime imports from Convex implementation files into shared specs.
- Throwing raw provider errors across public boundaries.
- Hiding workspace identity or policy snapshots in untyped `any` blobs.
- Importing from `repos/`; those directories are read-only reference material.

## Verification Commands

```bash
pnpm confect:codegen
pnpm check:confect-contracts
pnpm --dir packages/convex test
```
