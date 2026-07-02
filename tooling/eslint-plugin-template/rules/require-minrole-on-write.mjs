/**
 * require-minrole-on-write — every workspaceMutation and workspaceAction call
 * must declare an explicit `minRole` property in its config object. A missing
 * minRole is a silent implicit-viewer write, which is the bug class this gate
 * prevents. workspaceQuery is exempt (viewer reads are fine as the default).
 *
 * FORWARD GUARD — this repo does not define workspace* builders yet. When
 * workspace-scoped function builders land (intended home:
 * packages/convex/confect/capabilities/**), this rule enforces the explicit
 * role decision on every write from day one.
 */

const WRITE_BUILDERS = new Set(["workspaceMutation", "workspaceAction"]);

/**
 * Returns the property name for an ObjectExpression property, or null if it
 * cannot be statically determined (computed key, shorthand without name, etc.).
 */
function propertyName(prop) {
  if (prop.type !== "Property") return null;
  if (prop.key.type === "Identifier") return prop.key.name;
  if (prop.key.type === "Literal" && typeof prop.key.value === "string") {
    return prop.key.value;
  }
  return null;
}

export default {
  meta: {
    type: "problem",
    docs: {
      description:
        "workspaceMutation and workspaceAction calls must declare an explicit minRole",
    },
    schema: [],
    messages: {
      missing:
        "Declare an explicit minRole on this write capability — implicit viewer-writes are the bug class this gate prevents.",
    },
  },
  create(context) {
    const filename = (context.filename ?? context.getFilename()).replace(
      /\\/g,
      "/",
    );

    // Test files are exempt.
    if (filename.includes(".test.") || filename.includes("/__tests__/")) {
      return {};
    }

    return {
      CallExpression(node) {
        if (
          node.callee.type !== "Identifier" ||
          !WRITE_BUILDERS.has(node.callee.name)
        ) {
          return;
        }
        const config = node.arguments[0];
        if (!config || config.type !== "ObjectExpression") return;

        const hasMinRole = config.properties.some(
          (prop) => propertyName(prop) === "minRole",
        );
        if (!hasMinRole) {
          context.report({ node, messageId: "missing" });
        }
      },
    };
  },
};
