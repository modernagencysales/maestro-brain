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

| Surface        | Package(s)                                                                                 | Version                                           | Evidence                                                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Confect server | `@confect/core`, `@confect/server`, `@confect/cli`, `@confect/test`                        | `9.1.4`                                           | Package metadata: peers require Effect `^3.21.2`, Convex `^1.32.0`, `@effect/platform` `^0.96.1`, and `@effect/platform-node` `^0.106.0`. |
| Confect client | `@confect/react`, `@confect/js`                                                            | `9.1.4`                                           | Package metadata: peers require Effect `^3.21.2`, Convex `^1.32.0`, and React `^18` or `^19` for React hooks.                             |
| Effect runtime | `effect`, `@effect/platform`, `@effect/platform-node`, `@effect/cluster`, `@effect/vitest` | `3.21.4`, `0.96.2`, `0.106.0`, `0.58.0`, `0.29.0` | `@effect/platform-node@0.106.0` matches Confect's `^0.106.0` peer; `0.107.0` is intentionally not used.                                   |
| Convex         | `convex`, `convex-test`                                                                    | `1.42.1`, `0.0.54`                                | Satisfies Confect peers and `@confect/test`'s `convex-test >=0.0.50 <0.1.0` peer.                                                         |

## File Model

- Tables: `packages/convex/confect/tables/*`
- Specs: `packages/convex/confect/**/<group>.spec.ts`
- Impls: `packages/convex/confect/**/<group>.impl.ts`
- Plain Convex interop: colocated `.ts`, `.spec.ts`, and `.impl.ts`
- Special entrypoints: `confect/auth.ts`, `confect/crons.ts`, `confect/http.ts`

## Convex Component Interop

- Plain Convex functions required by Convex components must live beside their
  Confect spec and impl files.
- Specs must import plain Convex functions with `import type`; impls pass the
  real function values to `FunctionImpl.make`.
- Local template typechecks may use narrow component-reference shims when Convex
  deployment codegen has not been provisioned yet. Provisioned apps must run
  `convex dev` or `convex codegen` and prefer generated `components` refs.
- `check:confect-contracts` must fail if a spec runtime-imports plain Convex
  functions or if generated Confect wrappers are stale.

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
