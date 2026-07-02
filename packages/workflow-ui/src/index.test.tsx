import { describe, expect, it } from "vitest";
import {
  deriveWorkflowFlowModel,
  summarizeWorkflowValidationHints,
  type DurableWorkflowGraphForCanvas,
} from "./index";

const graph: DurableWorkflowGraphForCanvas = {
  id: "workflow_source_grounded_plan",
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
    {
      id: "agent",
      label: "Planner Agent",
      kind: "agent",
      agent: "planner",
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
  ],
  edges: [
    {
      id: "source-to-brief",
      sourceNodeId: "source",
      targetNodeId: "brief",
    },
    {
      id: "brief-to-agent",
      sourceNodeId: "brief",
      targetNodeId: "agent",
      condition: { expression: "result.status == 'ready'" },
    },
  ],
  joins: [],
};

describe("workflow-ui graph derivation", () => {
  it("derives React Flow nodes and edges from durable workflow metadata", () => {
    const model = deriveWorkflowFlowModel(graph);

    expect(model.nodes.map((node) => node.id)).toEqual([
      "source",
      "brief",
      "agent",
    ]);
    expect(model.nodes[1]).toMatchObject({
      id: "brief",
      position: { x: 260, y: 20 },
      data: {
        label: "capability: Source-grounded brief",
        kind: "capability",
        capability: "sourceGroundedBrief",
        validationHints: [],
      },
    });
    expect(model.edges).toEqual([
      {
        id: "source-to-brief",
        source: "source",
        target: "brief",
        label: undefined,
        animated: false,
        data: { validationHints: [] },
      },
      {
        id: "brief-to-agent",
        source: "brief",
        target: "agent",
        label: "result.status == 'ready'",
        animated: true,
        data: { validationHints: [] },
      },
    ]);
  });

  it("keeps validation hints as derived overlays instead of graph data", () => {
    const model = deriveWorkflowFlowModel(graph, [
      {
        target: "node",
        id: "brief",
        severity: "warning",
        message: "Capability requires approval before live provider use.",
      },
      {
        target: "edge",
        id: "brief-to-agent",
        severity: "error",
        message: "Condition must compile before save.",
      },
    ]);

    expect(model.nodes[1]?.data.validationHints).toEqual([
      {
        severity: "warning",
        message: "Capability requires approval before live provider use.",
      },
    ]);
    expect(model.edges[1]?.data?.validationHints).toEqual([
      {
        severity: "error",
        message: "Condition must compile before save.",
      },
    ]);
    expect(summarizeWorkflowValidationHints(model)).toEqual({
      errors: 1,
      warnings: 1,
    });
  });
});
