/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-web-to-convex-internals",
      severity: "error",
      comment:
        "Web code may depend on public package/type boundaries, not Convex internals.",
      from: { path: "^apps/web/src" },
      to: { path: "^packages/convex/(confect|convex|test)" },
    },
    {
      name: "no-feature-to-route-modules",
      severity: "error",
      comment:
        "Feature modules stay route-agnostic; routes compose screens/features.",
      from: { path: "^apps/web/src/features" },
      to: { path: "^apps/web/src/routes" },
    },
    {
      name: "workflow-ui-does-not-import-app",
      severity: "error",
      comment:
        "Reusable workflow UI must remain independent of the hosted app.",
      from: { path: "^packages/workflow-ui/src" },
      to: { path: "^apps/web/src" },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules|dist|repos|vendor|test-results",
    },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["types", "import", "default"],
    },
  },
};
