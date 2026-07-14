import { describe, expect, it } from "vitest";
import {
  changedHandAuthoredSourceLines,
  isHandAuthoredSource,
} from "../src/source-budget.js";

describe("Brain task source budgets", () => {
  it("counts application and tooling source changes", () => {
    expect(
      changedHandAuthoredSourceLines(
        [
          "20\t2\tpackages/integrations/src/llm.ts",
          "10\t0\tapps/web/src/feature.tsx",
          "5\t1\ttooling/evals/src/index.mts",
        ].join("\n"),
      ),
    ).toBe(38);
  });

  it("excludes tests, fixtures, generated output, docs, and vendored source", () => {
    expect(
      changedHandAuthoredSourceLines(
        [
          "200\t0\tpackages/convex/test/brain.test.ts",
          "200\t0\ttooling/evals/fixtures/cases.ts",
          "200\t0\tpackages/convex/convex/_generated/api.js",
          "200\t0\tdocs/product/brain.md",
          "200\t0\trepos/effect/packages/effect/src/Effect.ts",
        ].join("\n"),
      ),
    ).toBe(0);
  });

  it("recognizes only hand-authored source roots", () => {
    expect(isHandAuthoredSource("packages/search/src/index.ts")).toBe(true);
    expect(isHandAuthoredSource("scripts/tool.mjs")).toBe(false);
  });
});
