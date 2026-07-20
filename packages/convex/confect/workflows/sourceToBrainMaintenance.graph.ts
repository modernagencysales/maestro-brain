import type { DurableWorkflowGraph } from "./graph";

export const sourceToBrainMaintenanceGraph = {
  id: "workflow_sourceToBrainMaintenance",
  version: 1,
  startNodeId: "start",
  nodes: [
    {
      id: "start",
      kind: "source",
      label: "sourceToBrainMaintenance start",
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: "maintainBrainPage",
      kind: "capability",
      label: "Maintain cited Brain page",
      capability: "capabilities.maintainBrainPage",
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: "receipt",
      kind: "output",
      label: "Trust Receipt",
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
  ],
  edges: [
    {
      id: "edge_start_maintainBrainPage",
      sourceNodeId: "start",
      targetNodeId: "maintainBrainPage",
    },
    {
      id: "edge_maintainBrainPage_receipt",
      sourceNodeId: "maintainBrainPage",
      targetNodeId: "receipt",
    },
  ],
  joins: [],
} satisfies DurableWorkflowGraph;
