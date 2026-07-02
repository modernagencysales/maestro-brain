/**
 * frontend-route-thin — TanStack Start route modules are composition entrypoints:
 * metadata/params handoff + render. They do not own client state, browser APIs,
 * Convex hooks, or product derivation. The auth callback route
 * (apps/web/src/routes/callback.tsx, the WorkOS AuthKit redirect target) is the
 * one client-redirect exception; the root route (__root.tsx) is the one place
 * allowed to import `convex/react` (it mounts the provider).
 */
const CLIENT_HOOKS = new Set([
  "useState",
  "useReducer",
  "useEffect",
  "useLayoutEffect",
  "useMemo",
  "useCallback",
  "useQuery",
  "useMutation",
  "useAction",
]);
const BROWSER_GLOBALS = new Set([
  "window",
  "document",
  "localStorage",
  "sessionStorage",
  "URLSearchParams",
]);
const FORBIDDEN_IMPORTS = new Set(["convex/react"]);

function inRoute(filename) {
  return /apps\/web\/src\/routes\/.*\.(tsx|ts)$/.test(filename);
}

function allowedException(filename) {
  return filename.endsWith("apps/web/src/routes/callback.tsx");
}

function isRootProviderBoundary(filename, source) {
  return (
    source === "convex/react" &&
    filename.endsWith("apps/web/src/routes/__root.tsx")
  );
}

export default {
  meta: {
    type: "problem",
    docs: { description: "Keep TanStack Start route modules thin" },
    schema: [],
    messages: {
      client:
        "Route modules are server composition entrypoints; do not mark them `use client` outside blessed callback routes.",
      import:
        "Start route modules must not import `{{source}}`; move client/data behavior into a screen, feature, or adapter.",
      hook: "Route modules must not call `{{name}}`; move client state/effects/data hooks below the route.",
      browser:
        "Route modules must not read browser global `{{name}}`; use a feature adapter or approved shell boundary.",
      ambient:
        "Route modules must not use ambient time/random; inject through a lower layer when needed.",
    },
  },
  create(context) {
    const filename = (context.filename ?? context.getFilename()).replace(
      /\\/g,
      "/",
    );
    if (!inRoute(filename) || allowedException(filename)) return {};

    return {
      Program(node) {
        const first = node.body[0];
        if (
          first?.type === "ExpressionStatement" &&
          first.expression.type === "Literal" &&
          first.expression.value === "use client"
        ) {
          context.report({ node: first, messageId: "client" });
        }
      },
      ImportDeclaration(node) {
        const source = String(node.source.value);
        if (isRootProviderBoundary(filename, source)) {
          return;
        }
        if (
          FORBIDDEN_IMPORTS.has(source) ||
          source === "next" ||
          source.startsWith("next/")
        ) {
          context.report({
            node: node.source,
            messageId: "import",
            data: { source },
          });
        }
      },
      CallExpression(node) {
        const callee = node.callee;
        const name = callee.type === "Identifier" ? callee.name : null;
        if (name && CLIENT_HOOKS.has(name)) {
          context.report({ node, messageId: "hook", data: { name } });
        }
        if (
          callee.type === "MemberExpression" &&
          callee.object.type === "Identifier" &&
          ((callee.object.name === "Date" &&
            callee.property.type === "Identifier" &&
            callee.property.name === "now") ||
            (callee.object.name === "Math" &&
              callee.property.type === "Identifier" &&
              callee.property.name === "random"))
        ) {
          context.report({ node, messageId: "ambient" });
        }
      },
      NewExpression(node) {
        if (node.callee.type === "Identifier" && node.callee.name === "Date") {
          context.report({ node, messageId: "ambient" });
        }
      },
      Identifier(node) {
        if (BROWSER_GLOBALS.has(node.name)) {
          context.report({
            node,
            messageId: "browser",
            data: { name: node.name },
          });
        }
      },
    };
  },
};
