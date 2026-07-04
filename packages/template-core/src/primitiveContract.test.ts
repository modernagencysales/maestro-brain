import { describe, expect, it } from "vitest";
import {
  checkPrimitiveContract,
  createPrimitiveContract,
  type PrimitiveContract,
} from "./primitiveContract";

const completeContract = createPrimitiveContract({
  name: "sourceGroundedBrief",
  namespace: "template.capabilities",
  version: 1,
  runtimes: [
    "domain",
    "confect-action",
    "convex-workflow",
    "frontend-view-model",
  ],
  surfaces: ["web", "workflow", "internal"],
  hasInternalWorkflowStep: true,
  uiStates: ["loading", "empty", "ready", "typed-error"],
  files: [
    { path: "src/domain/sourceGroundedBrief.ts", kind: "domain" },
    { path: "confect/sourceGroundedBrief.spec.ts", kind: "spec" },
    { path: "confect/sourceGroundedBrief.impl.ts", kind: "impl" },
    {
      path: "convex/workflows/sourceGroundedBrief.ts",
      kind: "workflow-handler",
    },
    {
      path: "src/sourceGroundedBrief/viewState.ts",
      kind: "frontend-state",
    },
    {
      path: "src/sourceGroundedBrief/manifest.ts",
      kind: "manifest",
    },
    { path: "src/sourceGroundedBrief.test.ts", kind: "test" },
    { path: "docs/source-grounded-brief.md", kind: "docs" },
  ],
} satisfies PrimitiveContract);

describe("primitive contract", () => {
  it("complete effectified-full primitive has no findings", () => {
    expect(checkPrimitiveContract(completeContract)).toEqual([]);
  });

  it("removing manifest reports exposed primitive manifest metadata", () => {
    const withoutManifest = createPrimitiveContract({
      ...completeContract,
      files: completeContract.files.filter((file) => file.kind !== "manifest"),
    });

    expect(checkPrimitiveContract(withoutManifest)).toEqual([
      {
        field: "files",
        message: "Exposed primitives need manifest metadata.",
      },
    ]);
  });
});
