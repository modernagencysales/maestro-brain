/**
 * no-throw-tagged-error — a `Schema.TaggedError` is an Effect value, never a
 * throwable. Signal it, don't throw it.
 *
 * WHY — a tagged error is the typed-failure currency of the whole backend:
 * `yield* new Forbidden(...)` / `Effect.fail(...)` / `Either.left(new Forbidden(...))`.
 * The moment one is `throw`n and reaches an `Effect.gen`, the runtime turns it
 * into a DEFECT (`Cause.Die`), it escapes Confect's error-schema encoder, and
 * the client gets a generic 500 instead of the declared typed error. This rule
 * makes that impossible at the source — pure planners return
 * `Either<_, TaggedError>`, handlers `yield*` it, and nobody throws domain
 * errors anywhere in the backend.
 *
 * COMPLEMENTS `no-throw-in-effect-handler` (which bans ALL throws inside
 * `*.impl.ts`). This rule is broader in surface (every confect file) but
 * narrower in target (only tagged errors): a genuine invariant guard may still
 * `throw new Error(...)` — a plain Error is an intentional defect and is left
 * alone.
 *
 * HOW IT DETECTS A TAGGED ERROR — a `throw new X(...)` where `X` is a binding
 * imported from an errors module (an import whose source path contains
 * `errors`, e.g. `../errors`, `./shared/errors`, `../headless/auth` re-exports
 * are not covered — keep tagged errors in `errors`-named modules). This is the
 * repo convention: every `Schema.TaggedError` lives in an `errors.ts`. A throw
 * of a locally-declared `class X extends Schema.TaggedError()` in the same file
 * is also flagged. Plain `throw new Error(...)` and throws of non-error-module
 * identifiers are untouched.
 *
 * SCOPE — packages/convex/confect/** excluding tests.
 */
const CONFECT_RE = /(?:^|\/)packages\/convex\/confect\//;

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Never `throw` a Schema.TaggedError — it becomes an untyped defect inside Effect.gen. Signal it with Either.left / Effect.fail / yield*.",
    },
    schema: [],
    messages: {
      noThrowTagged:
        "Don't `throw` the tagged error `{{name}}` — a thrown tagged error becomes an untyped defect inside Effect.gen and escapes the client error contract. Return `Either.left(new {{name}}(...))` from a planner, or `yield* new {{name}}(...)` / `Effect.fail(...)` in a handler.",
    },
  },
  create(context) {
    const filename = (context.filename ?? context.getFilename()).replace(
      /\\/g,
      "/",
    );
    if (!CONFECT_RE.test(filename)) return {};
    if (filename.includes(".test.") || filename.includes("/__tests__/")) {
      return {};
    }

    // Local names bound to a tagged error: imported from an `errors` module, or
    // declared in-file as `class X extends Schema.TaggedError...`.
    const taggedNames = new Set();

    return {
      ImportDeclaration(node) {
        const source = String(node.source.value ?? "");
        if (!/errors/.test(source)) return;
        for (const spec of node.specifiers) {
          if (spec.type === "ImportSpecifier") {
            taggedNames.add(spec.local.name);
          }
        }
      },
      ClassDeclaration(node) {
        if (isTaggedErrorClass(node) && node.id) {
          taggedNames.add(node.id.name);
        }
      },
      ThrowStatement(node) {
        const arg = node.argument;
        if (
          arg?.type === "NewExpression" &&
          arg.callee.type === "Identifier" &&
          taggedNames.has(arg.callee.name)
        ) {
          context.report({
            node,
            messageId: "noThrowTagged",
            data: { name: arg.callee.name },
          });
        }
      },
    };
  },
};

/**
 * True if a class extends a `Schema.TaggedError<...>()(...)` call — the shape
 * `class X extends Schema.TaggedError<X>()("X", {...}) {}`. Matches on the
 * `.TaggedError` member of the superclass callee, however `Schema` is aliased.
 */
function isTaggedErrorClass(node) {
  let superClass = node.superClass;
  if (!superClass) return false;
  // extends Schema.TaggedError<...>()(...)  -> unwrap call expressions
  while (superClass.type === "CallExpression") {
    superClass = superClass.callee;
  }
  return (
    superClass.type === "MemberExpression" &&
    !superClass.computed &&
    superClass.property.type === "Identifier" &&
    superClass.property.name === "TaggedError"
  );
}
