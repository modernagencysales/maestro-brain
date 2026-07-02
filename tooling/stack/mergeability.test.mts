import { expect, test, vi } from "vitest";
import { type Runner } from "./exec.mts";
import { conflictsAgainstMain } from "./mergeability.mts";

test("clean merge-tree (no CONFLICT lines) => no conflicts", () => {
  const run = vi.fn<Runner>(() => "mergedtreeoid\n");
  expect(conflictsAgainstMain(run, "HEAD")).toEqual([]);
});

test("merge-tree reporting CONFLICT => the conflicted files", () => {
  const run = vi.fn<Runner>(
    () =>
      "treeoid\npackages/convex/convex/schema.ts\n\nCONFLICT (content): Merge conflict in packages/convex/convex/schema.ts",
  );
  expect(conflictsAgainstMain(run, "HEAD")).toEqual([
    "packages/convex/convex/schema.ts",
  ]);
});
