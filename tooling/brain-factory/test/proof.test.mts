import { describe, expect, it } from "vitest";
import { isCompatibleProofHead } from "../src/proof.js";

describe("Fabro checkpoint proof heads", () => {
  it("accepts the exact proved head", () => {
    expect(
      isCompatibleProofHead({
        ancestorExit: 1,
        currentHead: "same",
        proofHead: "same",
        treeDiffExit: 1,
      }),
    ).toBe(true);
  });

  it("accepts a same-tree checkpoint descendant", () => {
    expect(
      isCompatibleProofHead({
        ancestorExit: 0,
        currentHead: "checkpoint",
        proofHead: "task",
        treeDiffExit: 0,
      }),
    ).toBe(true);
  });

  it("rejects divergent code after proof", () => {
    expect(
      isCompatibleProofHead({
        ancestorExit: 0,
        currentHead: "changed",
        proofHead: "task",
        treeDiffExit: 1,
      }),
    ).toBe(false);
  });
});
