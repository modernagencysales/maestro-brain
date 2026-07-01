# Confect And Effect Guide

The template uses Confect to integrate Effect schemas and services with Convex.
The goal is end-to-end typed contracts without losing Convex component support.

## Version Policy

- Pin all `@confect/*` packages to one released version.
- Pin `effect` and companion `@effect/*` packages to a tested compatible set.
- Do not install fallback placeholder versions. Resolve package metadata first,
  then record the exact compatibility pair in this guide.
- Do not adopt Effect v4 or beta lines until Confect compatibility is verified
  in CI.
- Record version changes in this guide and in the lockfile diff.

## Compatibility Matrix

| Surface        | Package(s)                         | Version | Evidence                                |
| -------------- | ---------------------------------- | ------- | --------------------------------------- |
| Confect server | `@confect/core`, `@confect/server` | Pending | Resolve before Task 5 implementation.   |
| Confect client | `@confect/react`, `@confect/js`    | Pending | Resolve before Task 5 implementation.   |
| Effect runtime | `effect`, `@effect/*`              | Pending | Must satisfy Confect peer dependencies. |
| Convex         | `convex`, `convex-test`            | Pending | Must pass codegen and `@confect/test`.  |

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
- Public-safe errors are separate from internal provider/config errors. Provider
  payloads, secret names, secret values, and stack traces are redacted before
  crossing public Confect boundaries.
- Queries are read-only and deterministic. Mutations perform transactional
  writes. Actions and scheduled functions own external provider side effects.
- Specs use type-only imports for plain Convex function values with
  `import type`.
- Impls end with `GroupImpl.finalize`.
- Confect schemas must have Convex-serializable encoded values and no schema
  context. Cover Dates, branded ids, unions, nullable fields, transforms, and
  arrays with compile-time and runtime schema tests.

## Client Rules

- Web uses `@confect/react` generated refs.
- CLI and MCP use `@confect/js` generated refs.
- HTTP APIs call generated runner services rather than duplicating business
  logic.
- React adapters distinguish loading, empty, ready, skipped, typed failure,
  parse failure, transport failure, and defects.
- Feature surfaces use shared Confect React adapters rather than hand-rolled raw
  hook handling.
- Type assertions prove refs infer args, returns, typed failures, `QueryResult`,
  `Either`, and JS-client error channels.

## Testing

Use `@confect/test` for generated refs, auth identity, typed errors, HTTP
routes, scheduled functions, storage, Node actions, and plain Convex interop.

Run `check:confect-compat` after every Confect contract change. It must cover
codegen, generated-file diffs, `@confect/test`, HTTP/Scalar fetch, React type
fixtures, and JavaScript client type fixtures.
