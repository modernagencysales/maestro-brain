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
  ignorePatterns: [
    "apps/**",
    "docs/**",
    "node_modules/**",
    "packages/**/dist/**",
    "packages/convex/confect/_generated/**",
    "repos/**",
    "vendor/**",
  ],
  thresholds: {
    high: 75,
    low: 60,
    break: 55,
  },
  vitest: {
    configFile: "vitest.config.ts",
    related: true,
  },
  typescriptChecker: {
    prioritizePerformanceOverAccuracy: true,
  },
};
