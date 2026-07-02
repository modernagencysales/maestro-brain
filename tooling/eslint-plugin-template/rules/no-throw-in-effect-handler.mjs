/**
 * no-throw-in-effect-handler — inside an Effect handler, failures travel the
 * typed error channel, never `throw`.
 *
 * WHY THIS IS A CORRECTNESS GATE, NOT STYLE — a `throw` that executes inside
 * (or is reached from) `Effect.gen(function* () { … })` is caught by the Effect
 * runtime and turned into a DEFECT (`Cause.Die`), not a typed failure
 * (`Cause.Fail`). Confect's handler runner encodes only the FAILURE channel
 * into a client `ConvexError` (`Effect.catchAll` over the error schema); a
 * defect escapes that encoder, the fiber dies, and `runPromise` rejects with a
 * generic internal error. The declared typed error in the function `.spec.ts`
 * (`Forbidden`, `ValidationFailed`, …) NEVER reaches the client — the whole
 * point of the typed contract is silently lost. Proven against the pinned
 * effect build: `throw new Forbidden()` inside a gen yields `Cause.Die`;
 * `yield* new Forbidden()` yields `Cause.Fail`.
 *
 * THE FIX — surface the error through the channel instead of throwing:
 *   - a TaggedError instance IS an Effect: `return yield* new Forbidden({ … })`
 *     or `yield* Effect.fail(new Forbidden({ … }))`.
 *   - calling a pure planner that throws its domain error? wrap it so the throw
 *     becomes a typed failure at the boundary:
 *       Effect.try({ try: () => plan(input), catch: (e) => e as PlanError })
 *     (see access/provisioning.impl.ts `selectProvisioningRow` for the pattern).
 *   - a genuine unreachable invariant is a defect ON PURPOSE — say so with
 *     `Effect.dieMessage("…")` / `yield* Effect.die(…)`, not a bare `throw`.
 *
 * SCOPE — Effect handler modules: `*.impl.ts` under packages/convex/confect/**
 * (the files that call `FunctionImpl.make` and run inside the Confect runner).
 * Pure planner/domain modules (`lifecycle.ts`, `roles.ts`, `auth.ts`, …) do NOT
 * import `effect/Effect` and are OUT of scope here on purpose: they are unit-
 * tested as throwing pure functions and are converted to typed failures at the
 * `.impl.ts` boundary. `.test.`/`__tests__` files are exempt.
 *
 * KNOWN BOUNDARY — this flags `throw` STATEMENTS lexically inside an `.impl.ts`
 * file. It does not chase a throw across a call into a planner module (no
 * dataflow); that indirect leak is the reason the boundary wrap above is the
 * documented convention, and Effect's own LSP `floatingEffect` / defect
 * diagnostics are the second net.
 */
const IMPL_RE = /(?:^|\/)packages\/convex\/confect\/.*\.impl\.ts$/;

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Effect handlers surface failures through the typed error channel (yield*/Effect.fail), never `throw` — a throw inside Effect.gen becomes an untyped defect that escapes the client error contract",
    },
    schema: [],
    messages: {
      noThrow:
        "Don't `throw` inside an Effect handler — a throw in Effect.gen becomes an untyped DEFECT and never reaches the client as the declared typed error. Use `return yield* new MyError(...)` / `Effect.fail(...)`, wrap a throwing planner in `Effect.try({ try, catch })`, or state a real invariant with `Effect.dieMessage(...)`.",
    },
  },
  create(context) {
    const filename = (context.filename ?? context.getFilename()).replace(
      /\\/g,
      "/",
    );
    if (!IMPL_RE.test(filename)) return {};
    if (filename.includes(".test.") || filename.includes("/__tests__/")) {
      return {};
    }
    return {
      ThrowStatement(node) {
        context.report({ node, messageId: "noThrow" });
      },
    };
  },
};
