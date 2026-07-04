import { describe, expect, it } from "vitest";
import {
  deriveWorkflowCanvasAdapterView,
  type WorkflowCanvasAdapterInput,
} from "./workflowCanvasAdapter";

const input: WorkflowCanvasAdapterInput = {
  graph: {
    id: "workflow_source_grounded_brief",
    version: 1,
    startNodeId: "source",
    nodes: [
      {
        id: "source",
        label: "Source Set",
        kind: "source",
        retry: { maxAttempts: 1, backoffMs: 0 },
      },
      {
        id: "brief",
        label: "Source-grounded brief",
        kind: "capability",
        capability: "sourceGroundedBrief",
        retry: { maxAttempts: 2, backoffMs: 250 },
      },
    ],
    edges: [
      {
        id: "source-to-brief",
        sourceNodeId: "source",
        targetNodeId: "brief",
      },
    ],
    joins: [],
  },
  stageMap: { source_grounded_brief: "brief" },
  stages: [
    {
      stageKey: "source_grounded_brief",
      status: "running",
      attemptNumber: 1,
      summary: "Calling provider",
    },
  ],
};

describe("deriveWorkflowCanvasAdapterView", () => {
  it("overlays live stage runs on the ready workflow canvas view", () => {
    const view = deriveWorkflowCanvasAdapterView(input);

    expect(view.status).toBe("ready");
    if (view.status === "ready") {
      expect(
        view.model.nodes.find((node) => node.id === "brief")?.data,
      ).toMatchObject({
        status: "running",
        runSummary: "Calling provider",
      });
    }
  });
});
