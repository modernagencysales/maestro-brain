import { describe, expect, it } from "vitest";

import {
  generatedConfectDeltaIssues,
  safeFocusedTestPattern,
  sameGeneratedFileSet,
} from "../src/transient-confect-codegen.js";

describe("transient Confect codegen", () => {
  it("accepts only Confect-owned generated surfaces", () => {
    expect(
      generatedConfectDeltaIssues([
        "packages/convex/confect/_generated/schema.ts",
        "packages/convex/convex/internal/migrations.ts",
        "packages/convex/convex/schema.ts",
      ]),
    ).toEqual([]);
  });

  it("rejects hand-authored and reserved generated-directory drift", () => {
    expect(
      generatedConfectDeltaIssues([
        "packages/convex/confect/internal/migrations.ts",
        "packages/convex/convex/auth.config.ts",
        "packages/convex/convex/convex.config.ts",
        "packages/convex/convex/http.ts",
        "packages/convex/convex/tsconfig.json",
      ]),
    ).toEqual([
      "packages/convex/confect/internal/migrations.ts",
      "packages/convex/convex/auth.config.ts",
      "packages/convex/convex/convex.config.ts",
      "packages/convex/convex/http.ts",
      "packages/convex/convex/tsconfig.json",
    ]);
  });

  it("binds freshness to the same staged generated delta", () => {
    expect(sameGeneratedFileSet(["b.ts", "a.ts"], ["a.ts", "b.ts"])).toBe(true);
    expect(sameGeneratedFileSet(["a.ts"], ["a.ts", "b.ts"])).toBe(false);
  });

  it("allows only shell-free focused test patterns", () => {
    expect(safeFocusedTestPattern("migrations")).toBe(true);
    expect(safeFocusedTestPattern("brain-pages.contract")).toBe(true);
    expect(safeFocusedTestPattern("../../outside")).toBe(false);
    expect(safeFocusedTestPattern("migrations;rm")).toBe(false);
  });
});
