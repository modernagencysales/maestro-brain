# Confect And Effect Guide

The template uses Confect to integrate Effect schemas and services with Convex.
The goal is end-to-end typed contracts without losing Convex component support.

## Version Policy

- Pin all `@confect/*` packages to one released version.
- Pin `effect` and companion `@effect/*` packages to a tested compatible set.
- Do not adopt Effect v4 or beta lines until Confect compatibility is verified
  in CI.
- Record version changes in this guide and in the lockfile diff.

## File Model

- Tables: `packages/convex/confect/tables/*`
- Specs: `packages/convex/confect/**/<group>.spec.ts`
- Impls: `packages/convex/confect/**/<group>.impl.ts`
- Plain Convex interop: colocated `.ts`, `.spec.ts`, and `.impl.ts`
- Special entrypoints: `confect/auth.ts`, `confect/crons.ts`, `confect/http.ts`

## Function Rules

- Args, returns, and expected errors use Effect schemas.
- No useful return means `Schema.Null`.
- Expected failures use tagged errors and the Effect error channel.
- Unexpected defects may die; they must not serialize private data.
- Specs use type-only imports for plain Convex function values with
  `import type`.
- Impls end with `GroupImpl.finalize`.

## Client Rules

- Web uses `@confect/react` generated refs.
- CLI and MCP use `@confect/js` generated refs.
- HTTP APIs call generated runner services rather than duplicating business
  logic.
- React adapters distinguish loading, empty, ready, skipped, typed failure,
  parse failure, transport failure, and defects.

## Testing

Use `@confect/test` for generated refs, auth identity, typed errors, HTTP
routes, scheduled functions, storage, Node actions, and plain Convex interop.
