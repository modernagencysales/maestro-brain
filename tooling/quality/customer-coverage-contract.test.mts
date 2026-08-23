import { describe, expect, it } from "vitest";
import {
  CUSTOMER_COVERAGE_SCOPE,
  CUSTOMER_COVERAGE_SOURCE_GLOBS,
  CUSTOMER_COVERAGE_TEST_PATHS,
  customerCoverageArgv,
} from "./customer-coverage-contract.mts";

describe("generated customer coverage contract", () => {
  it("covers product runtime and standalone verification without factory publication trees", () => {
    expect(CUSTOMER_COVERAGE_SCOPE).toContain("generated-customer-owned");
    expect(CUSTOMER_COVERAGE_TEST_PATHS).toContain("apps/web");
    expect(CUSTOMER_COVERAGE_TEST_PATHS).toContain("packages/convex");
    expect(CUSTOMER_COVERAGE_TEST_PATHS).toContain(
      "tooling/release/src/deploy",
    );
    expect(CUSTOMER_COVERAGE_TEST_PATHS).not.toContain("tooling/release");
    expect(CUSTOMER_COVERAGE_TEST_PATHS).not.toContain("tooling/generators");
    expect(CUSTOMER_COVERAGE_SOURCE_GLOBS).not.toContain(
      "tooling/release/**/*.{ts,mts,tsx}",
    );
  });

  it("builds a deterministic single-process coverage command", () => {
    const argv = customerCoverageArgv();
    expect(argv.slice(0, 5)).toEqual([
      "run",
      "--coverage",
      "--pool=threads",
      "--maxWorkers=1",
      "--no-file-parallelism",
    ]);
    expect(argv).toContain("tooling/generators/src/customer-runtime.test.ts");
    expect(argv).toContain(
      "--coverage.include=tooling/release/src/deploy/**/*.{ts,mts,tsx}",
    );
  });
});
