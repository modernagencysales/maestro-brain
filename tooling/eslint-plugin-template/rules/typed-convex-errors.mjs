/**
 * typed-convex-errors — at a Convex function boundary, throw a typed
 * `ConvexError({ code, message })`, never a bare `Error`. Non-UI clients
 * (CLI/MCP) branch on `code`. Pure layers (domain modules, shared helpers) may
 * throw plain Error — it gets wrapped at the boundary.
 *
 * SCOPE — the boundary layers, matched as path substrings (configurable via
 * the `layers` option). Defaults target this repo's backend layout under
 * packages/convex/confect/**: `/capabilities/`, `/workflows/`, `/agents/`,
 * plus `/http.` (the confect HTTP router lives at confect/http.ts, not in an
 * http/ directory).
 */
export default {
  meta: {
    type: "problem",
    docs: {
      description: "Convex function layers throw ConvexError, not bare Error",
    },
    schema: [
      {
        type: "object",
        properties: { layers: { type: "array", items: { type: "string" } } },
        additionalProperties: false,
      },
    ],
    messages: {
      typed:
        "Throw a typed `ConvexError({ code, message })` at the function boundary, not a bare `Error` — non-UI clients branch on `code`.",
    },
  },
  create(context) {
    const filename = (context.filename ?? context.getFilename()).replace(
      /\\/g,
      "/",
    );
    const layers = context.options[0]?.layers ?? [
      "/capabilities/",
      "/workflows/",
      "/agents/",
      "/http.",
    ];
    if (!layers.some((l) => filename.includes(l))) return {};
    if (filename.includes(".test.") || filename.includes("/__tests__/"))
      return {};
    return {
      ThrowStatement(node) {
        const arg = node.argument;
        if (
          arg.type === "NewExpression" &&
          arg.callee.type === "Identifier" &&
          arg.callee.name === "Error"
        ) {
          context.report({ node, messageId: "typed" });
        }
      },
    };
  },
};
