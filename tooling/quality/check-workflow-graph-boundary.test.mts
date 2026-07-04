import { describe, expect, it } from "vitest";
import { expectDescriptorPassesAndFails } from "./src/check-test-helpers.mts";
import { descriptor } from "./check-workflow-graph-boundary.mts";

describe("check:workflow-graph-boundary", () => {
  it("passes and fails on its declared requirements", async () => {
    await expectDescriptorPassesAndFails(descriptor);
  });

  it("pins the headless projection entrypoint against React Flow imports", () => {
    expect(descriptor.requirements).toContainEqual(
      expect.objectContaining({
        file: "tooling/workflow/src/index.ts",
        absent: expect.arrayContaining(["@xyflow/react", "ReactFlow"]),
      }),
    );
  });
});
