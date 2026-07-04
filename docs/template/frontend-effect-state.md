# Frontend Effect State Policy

The template uses Effect heavily on the backend because typed errors, dependency
injection, scoped resources, retries, interruption, and telemetry compound
across Confect/Convex functions. The frontend has different pressure:
reactivity, async UI state, hydration, optimistic updates, push updates, and
bundle size.

## Default Stack

- TanStack Router/Start is the current route and SSR shell.
- Convex/Confect live hooks are the default server-state path for Convex data.
- TanStack Query stays only for the current `@convex-dev/react-query` router
  integration, route prefetching, and legacy surfaces that already depend on
  `QueryClient`.
- Generic Confect or Effect effects must not be wrapped directly in `useQuery`
  as the default integration.
- Workflow status, stage rows, and Trust Receipts should subscribe through
  Convex/Confect live queries because Convex is already reactive.

## Why Not Generic Effect In TanStack Query

TanStack Query models failures as rejected promises. Effect models expected
failures in the typed error channel and defects separately. Throwing from
`Effect.runPromise` erases the typed error unless a custom adapter restores it.
Moving failures into `Either` makes TanStack Query treat a failed operation as a
successful cache value, disabling the normal retry/error/cache model. Query
composition and cancellation also become fragile because TanStack Query's
internal cancellation semantics are not an Effect API.

## Approved Patterns

- Use generated Confect React hooks or plain Convex hooks for server state.
- Use `apps/web/src/adapters/confect-state.ts` to normalize skipped, loading,
  empty, ready, typed_failure, transport_failure, parse_failure, and defect
  states.
- Use `apps/web/src/adapters/effectBoundary.ts` only for rare isolated frontend
  actions that already need an Effect program.
- For complex local-first, worker-backed, streaming, optimistic, or
  Effect-runtime-aware frontend state, introduce Effect Atom behind
  `apps/web/src/effect-atom/*` or `packages/frontend-effect/*`. Start from the
  checked versions `@effect-atom/atom-react@0.5.0` and
  `@effect-atom/atom@0.5.3`, then recheck npm metadata in the implementation
  branch before editing `package.json`.
- Do not make Effect the React framework. React remains the renderer.

## Bundle Rules

- Client code imports Effect submodules such as `effect/Effect`,
  `effect/Schema`, and `effect/Either`.
- Client code does not import from the `effect` barrel.
- Effect Atom is opt-in and must land with a bundle-size note before becoming a
  template default.
