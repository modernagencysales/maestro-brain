import { describe, expect, it } from "vitest";

import { laneFileOwnershipIssues } from "../src/lane-ownership.js";

describe("lane file ownership", () => {
  it("accepts only exact manifest file locks", () => {
    expect(
      laneFileOwnershipIssues(
        [
          "docs/task.md",
          "packages/convex/confect/internal/example.ts",
          "packages/convex/convex/auth.config.ts",
          "packages/convex/convex/http.ts",
        ],
        [
          "@environment",
          "docs/task.md",
          "packages/convex/confect/internal/example.ts",
          "packages/convex/convex/auth.config.ts",
          "packages/convex/convex/http.ts",
        ],
      ),
    ).toEqual([]);
  });

  it("rejects undeclared and generated lane changes", () => {
    expect(
      laneFileOwnershipIssues(
        [
          "packages/convex/confect/_generated/schema.ts",
          "packages/convex/convex/internal/example.ts",
          "tooling/quality/undeclared.mts",
        ],
        ["packages/convex/confect/internal/example.ts"],
      ),
    ).toEqual([
      "packages/convex/confect/_generated/schema.ts: generated output is integration-owned",
      "packages/convex/convex/internal/example.ts: generated output is integration-owned",
      "tooling/quality/undeclared.mts: not declared in manifest fileLocks",
    ]);
  });
});
