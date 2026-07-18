import { describe, expect, it } from "vitest";

import { buildManifest, validateManifest } from "../src/manifest.js";

describe("Task 5 control-lane contract", () => {
  it("represents the tooling checkpoint separately from product tasks", () => {
    const manifest = buildManifest();
    const control = manifest.tasks.find((task) => task.taskId === "S15-T01");
    expect(control).toMatchObject({
      kind: "control",
      lane: "control",
      gateProfiles: ["tooling"],
      sourceSliceLimit: 4,
      fileLocks: [
        "tooling/brain-factory/src/integrate-wave.mts",
        "tooling/brain-factory/src/integration-lane-check.ts",
        "tooling/brain-factory/src/integration-wave.ts",
        "tooling/brain-factory/test/integration-result-check.test.mts",
        "tooling/brain-factory/test/integration-wave.test.mts",
      ],
      controlCommitChain: [
        "b0cc84cb3f26315d643df3580c0c8da75d29681e",
        "d62222b6d21751c84d559aad50a5be7ebaac8b56",
        "d9b697c04ed04e7d4954319dc9678139767865c8",
        "36b8c7e108044facc375d6f483abfdfcc5b4a813",
      ],
      controlHeadSha: "36b8c7e108044facc375d6f483abfdfcc5b4a813",
    });
    expect(
      manifest.tasks.filter((task) => task.kind !== "control"),
    ).toHaveLength(56);
    expect(validateManifest(manifest)).toEqual([]);
  });
});
