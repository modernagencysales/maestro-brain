import type { DurableWorkflowGraph } from "./graph";

export const sourceClassificationGraph = {
  id: "workflow_sourceClassification",
  version: 1,
  startNodeId: "start",
  nodes: [
    {
      id: "start",
      kind: "source",
      label: "sourceClassification start",
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: "classify",
      kind: "capability",
      label: "Classify immutable source unit",
      capability: "classification.model",
      retry: { maxAttempts: 2, backoffMs: 1_000 },
    },
    {
      id: "review",
      kind: "approval",
      label: "Admin classification review",
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: "commit",
      kind: "capability",
      label: "Commit reviewed source route",
      capability: "routes.commit",
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
      id: "edge_start_classify",
      sourceNodeId: "start",
      targetNodeId: "classify",
    },
    {
      id: "edge_classify_review",
      sourceNodeId: "classify",
      targetNodeId: "review",
    },
    {
      id: "edge_review_commit",
      sourceNodeId: "review",
      targetNodeId: "commit",
    },
    {
      id: "edge_commit_receipt",
      sourceNodeId: "commit",
      targetNodeId: "receipt",
    },
  ],
  joins: [],
} satisfies DurableWorkflowGraph;
