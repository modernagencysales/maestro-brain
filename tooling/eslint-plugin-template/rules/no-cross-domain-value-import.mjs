/**
 * no-cross-domain-value-import — domain modules are flat and self-contained.
 * Each domain module is an independently testable, replaceable unit of pure
 * transforms. Type-only imports from sibling modules are fine (they share shape
 * contracts without creating runtime coupling), but VALUE imports of siblings
 * are banned: if two domain modules need the same runtime function, it belongs
 * in a shared pure-helper layer or must be inlined.
 *
 * This is the gate against chained god-files — domain module A importing B
 * importing C, where changing one function cascades through everything. Flat
 * domain modules mean every function is auditable, testable, and replaceable
 * in isolation.
 *
 * SCOPE — under packages/convex/confect/**, two shapes (NOT tests):
 *   (a) files named `*.domain.ts` / `*.domain.tsx` — this repo's current
 *       convention (e.g. capabilities/sourceGroundedBrief.domain.ts);
 *   (b) files inside a `domain/` directory — the upstream convention, kept as
 *       a forward-guard in case a dedicated packages/convex/confect/domain/**
 *       layer is introduced (that is the intended glob if it lands).
 *
 * WHAT IT FLAGS — an ImportDeclaration that:
 *   (a) resolves to a sibling module (relative import starting with "./"),
 *   (b) is NOT `import type` (importKind !== "type").
 *
 * With `verbatimModuleSyntax: true`, `import { type X } from "./batch"` compiles
 * to `import {} from "./batch"` — the sibling module is STILL evaluated at
 * runtime. Only top-level `import type` is fully erased, so that's the only
 * form this gate allows for sibling imports.
 *
 * WHAT IT ALLOWS:
 *   - `import type { Channel } from "./batch"` — type-only import (no runtime)
 *   - imports from other layers (`../shared/`, `../tables/`, external packages)
 *
 * KNOWN BOUNDARY — dynamic `import()` expressions and re-exports are not
 * tracked; domain modules are all static imports today.
 */

const DOMAIN_DIR_RE = /(?:^|\/)packages\/convex\/confect\/(?:[^/]+\/)*domain\//;
const DOMAIN_FILE_RE =
  /(?:^|\/)packages\/convex\/confect\/.*\.domain\.(?:ts|tsx|mts)$/;

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "Domain modules are flat — import types from siblings freely, but never import values (shared runtime logic belongs in a shared pure layer)",
    },
    schema: [],
    messages: {
      valueImport:
        "Domain modules are flat and self-contained — use `import type { ... }` for sibling modules (top-level only; inline `type` specifiers still evaluate the module at runtime with verbatimModuleSyntax). Shared runtime logic belongs in a shared pure layer or should be inlined.",
    },
  },
  create(context) {
    const filename = (context.filename ?? context.getFilename()).replace(
      /\\/g,
      "/",
    );
    if (!DOMAIN_DIR_RE.test(filename) && !DOMAIN_FILE_RE.test(filename)) {
      return {};
    }
    if (filename.includes(".test.") || filename.includes("/__tests__/")) {
      return {};
    }

    return {
      ImportDeclaration(node) {
        if (node.importKind === "type") return;

        const source = node.source.value;
        if (typeof source !== "string") return;
        if (!source.startsWith("./")) return;

        context.report({ node, messageId: "valueImport" });
      },
    };
  },
};
