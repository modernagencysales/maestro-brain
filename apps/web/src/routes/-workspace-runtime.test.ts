import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

const rootRoute = readFileSync(
  new URL("./__root.tsx", import.meta.url),
  "utf8",
);

describe("workspace runtime composition", () => {
  it("reuses equivalent runtime operations and browser storage across route rerenders", () => {
    expect(rootRoute).toContain("reuseRuntimeWorkspaceOperations(");
    expect(rootRoute).toContain("const browserWorkspaceStorage =");
    expect(rootRoute).toContain("storage={browserWorkspaceStorage}");
  });
});
