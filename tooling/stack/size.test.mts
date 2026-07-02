import { expect, test, vi } from "vitest";
import { type Runner } from "./exec.mts";
import { changedSourceLines } from "./size.mts";

// `git diff --numstat` lines: "<added>\t<deleted>\t<path>".
const numstat = (rows: string) => vi.fn<Runner>(() => rows);

test("counts added+deleted in packages/apps .ts/.tsx, excludes generated/docs/lock", () => {
  const run = numstat(
    [
      "10\t2\tpackages/convex/convex/domain/x.ts",
      "5\t0\tpackages/convex/convex/domain/x.test.ts",
      "40\t0\tpackages/convex/convex/_generated/api.d.ts",
      "3\t1\tdocs/rule-coverage.md",
      "9\t9\tpnpm-lock.yaml",
      "2\t0\tapps/web/components/y.tsx",
    ].join("\n"),
  );
  // 10+2 (x.ts) + 5+0 (x.test.ts) + 2+0 (y.tsx) = 19
  expect(changedSourceLines(run, "feat/parent")).toBe(19);
});

test("counts renames explicitly (numstat rename row is path => path)", () => {
  const run = numstat("4\t4\tpackages/convex/convex/domain/{a => b}.ts");
  expect(changedSourceLines(run, "feat/parent")).toBe(8);
});
