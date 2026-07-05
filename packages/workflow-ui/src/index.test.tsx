import { describe, expect, it } from "vitest";
import {
  applyStatusOverlay,
  deriveWorkflowCanvasView,
  deriveWorkflowFlowModel,
  mapStageRunsToOverlay,
  summarizeWorkflowValidationHints,
  type DurableWorkflowGraphForCanvas,
  type WorkflowValidationHint,
} from "./workflowCanvasState";
import { shouldAnimateWorkflowEdge } from ".";

const graph: DurableWorkflowGraphForCanvas = {
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
      condition: { expression: "inputs.sources.length > 0" },
    },
  ],
  joins: [],
};

describe("workflow canvas state", () => {
  it("derives loading, empty, and ready canvas views", () => {
    expect(deriveWorkflowCanvasView(undefined)).toEqual({ status: "loading" });
    expect(
      deriveWorkflowCanvasView({ ...graph, nodes: [], edges: [] }),
    ).toEqual({ status: "empty" });

    const view = deriveWorkflowCanvasView(graph);

    expect(view.status).toBe("ready");
    if (view.status === "ready") {
      expect(view.model).toEqual(deriveWorkflowFlowModel(graph));
      expect(view.model.nodes.map((node) => node.id)).toEqual([
        "source",
        "brief",
      ]);
      expect(view.model.nodes[1]).toMatchObject({
        id: "brief",
        position: { x: 260, y: 20 },
        data: {
          label: "capability: Source-grounded brief",
          kind: "capability",
          capability: "sourceGroundedBrief",
          validationHints: [],
        },
        type: "default",
      });
      expect(view.model.edges[0]).toEqual({
        id: "source-to-brief",
        source: "source",
        target: "brief",
        label: "inputs.sources.length > 0",
        animated: true,
        data: { validationHints: [] },
      });
    }
  });

  it("keeps validation hints as overlays and summarizes severities", () => {
    const validationHints: readonly WorkflowValidationHint[] = [
      {
        target: "node",
        id: "brief",
        severity: "warning",
        message: "Capability requires approval before live provider use.",
      },
      {
        target: "edge",
        id: "source-to-brief",
        severity: "error",
        message: "Condition must compile before save.",
      },
    ];

    const model = deriveWorkflowFlowModel(graph, validationHints);

    expect(model.nodes[1]?.data.validationHints).toEqual([
      {
        severity: "warning",
        message: "Capability requires approval before live provider use.",
      },
    ]);
    expect(model.edges[0]?.data?.validationHints).toEqual([
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

  it("applies latest stage attempts as node status overlays", () => {
    const overlays = mapStageRunsToOverlay(
      [
        {
          stageKey: "source_grounded_brief",
          status: "failed",
          attemptNumber: 1,
          summary: "Provider timed out",
          errorCode: "PROVIDER_TIMEOUT",
        },
        {
          stageKey: "source_grounded_brief",
          status: "succeeded",
          attemptNumber: 2,
          summary: "Brief ready",
        },
      ],
      { source_grounded_brief: "brief" },
      ["source", "brief"],
    );

    const model = applyStatusOverlay(deriveWorkflowFlowModel(graph), overlays);

    expect(model.nodes.find((node) => node.id === "brief")?.data).toMatchObject(
      {
        status: "completed",
        runSummary: "Brief ready",
      },
    );
  });

  it("uses later same-attempt stage rows and clears stale run metadata", () => {
    const staleModel = applyStatusOverlay(deriveWorkflowFlowModel(graph), [
      {
        nodeId: "brief",
        status: "failed",
        summary: "Previous failure",
        errorCode: "PROVIDER_TIMEOUT",
      },
    ]);
    const overlays = mapStageRunsToOverlay(
      [
        {
          stageKey: "source_grounded_brief",
          status: "running",
          attemptNumber: 2,
          summary: "Calling provider",
        },
        {
          stageKey: "source_grounded_brief",
          status: "succeeded",
          attemptNumber: 2,
          summary: null,
          errorCode: null,
        },
      ],
      { source_grounded_brief: "brief" },
      ["source", "brief"],
    );

    const model = applyStatusOverlay(staleModel, overlays);

    expect(model.nodes.find((node) => node.id === "brief")?.data).toEqual({
      label: "capability: Source-grounded brief",
      kind: "capability",
      capability: "sourceGroundedBrief",
      validationHints: [],
      status: "completed",
    });
  });

  it("suppresses runtime edge animation when reduced motion is requested", () => {
    expect(
      shouldAnimateWorkflowEdge({
        edgeAnimated: true,
        reducedMotion: false,
      }),
    ).toBe(true);
    expect(
      shouldAnimateWorkflowEdge({
        edgeAnimated: true,
        reducedMotion: true,
      }),
    ).toBe(false);
    expect(
      shouldAnimateWorkflowEdge({
        edgeAnimated: false,
        reducedMotion: false,
      }),
    ).toBe(false);
  });
});
