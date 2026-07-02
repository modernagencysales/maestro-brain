/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  packageManager: "pnpm",
  plugins: [
    "@stryker-mutator/typescript-checker",
    "@stryker-mutator/vitest-runner",
  ],
  testRunner: "vitest",
  checkers: ["typescript"],
  coverageAnalysis: "perTest",
  reporters: ["clear-text", "progress"],
  mutate: [
    "packages/template-core/src/index.ts",
    "packages/integrations/src/rateLimit.ts",
    "packages/integrations/src/spend.ts",
    "packages/convex/confect/access/lifecycle.ts",
    "packages/convex/confect/workflows/runGraph.ts",
  ],
  // Sandbox contents: everything the scoped vitest run needs must survive
  // this list — the convex tests import confect/_generated, so generated
  // files stay in (the `mutate` list already keeps them unmutated).
  ignorePatterns: [
    ".pnpm-store/**",
    ".qlty/**",
    ".wrangler/**",
    "test-results/**",
    "apps/**",
    "docs/**",
    "node_modules/**",
    "packages/**/dist/**",
    "repos/**",
    "vendor/**",
  ],
  thresholds: {
    high: 75,
    low: 60,
    break: 55,
  },
  vitest: {
    configFile: "vitest.stryker.config.ts",
    related: true,
  },
  typescriptChecker: {
    prioritizePerformanceOverAccuracy: true,
  },
};
