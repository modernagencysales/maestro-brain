export const CUSTOMER_COVERAGE_SCOPE =
  "generated-customer-owned runtime and standalone verification v1";

export const CUSTOMER_COVERAGE_TEST_PATHS = [
  "packages/template-core",
  "packages/integrations",
  "packages/search",
  "packages/storage",
  "packages/notifications",
  "packages/observability",
  "packages/convex",
  "apps/web",
  "tooling/workflow/src/index.test.ts",
  "tooling/release/src/deploy",
  "tooling/generators/src/customer-runtime.test.ts",
  "tooling/ci/verify-chassis.test.mts",
  "tooling/ci/run-heavyweight-suites.test.mts",
  "tooling/ci/verify-aggregate.test.mts",
  "tooling/acceptance/product-contract.test.mts",
  "tooling/acceptance/playwright-report.test.mts",
  "tooling/acceptance/run-acceptance.test.mts",
] as const;

export const CUSTOMER_COVERAGE_SOURCE_GLOBS = [
  "{packages/template-core,packages/integrations,packages/search,packages/storage,packages/notifications,packages/observability,packages/convex,apps/web}/**/*.{ts,mts,tsx}",
  "tooling/workflow/src/**/*.{ts,mts,tsx}",
  "tooling/release/src/deploy/**/*.{ts,mts,tsx}",
  "tooling/generators/src/customer*.{ts,mts,tsx}",
  "tooling/ci/{verify-chassis,run-heavyweight-suites,verify-aggregate}.{mjs,mts}",
  "tooling/acceptance/**/*.{ts,mts,tsx}",
] as const;

export const CUSTOMER_COVERAGE_TEST_EXCLUSIONS = [
  "packages/convex/test/workflow-conformance.test.ts",
  "packages/convex/test/confect-codegen-component-roots.test.ts",
  "packages/convex/test/data-lifecycle.test.ts",
] as const;

export const customerCoverageArgv = (): readonly string[] => [
  "run",
  "--coverage",
  "--pool=threads",
  "--maxWorkers=1",
  "--no-file-parallelism",
  ...CUSTOMER_COVERAGE_TEST_EXCLUSIONS.flatMap((path) => ["--exclude", path]),
  ...CUSTOMER_COVERAGE_SOURCE_GLOBS.map((glob) => `--coverage.include=${glob}`),
  ...CUSTOMER_COVERAGE_TEST_PATHS,
];
