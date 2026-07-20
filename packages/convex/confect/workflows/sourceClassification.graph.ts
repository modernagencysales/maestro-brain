import type { DurableWorkflowGraph } from "./graph";

const retryOnce = { maxAttempts: 1, backoffMs: 0 };
const retryClassify = { maxAttempts: 2, backoffMs: 1_000 };

export const sourceClassificationGraph = {
  id: "workflow_sourceClassification",
  version: 1,
  startNodeId: "start",
  nodes: [
    ["start", "source", "sourceClassification start"],
    [
      "classify",
      "capability",
      "Classify immutable source unit",
      "classification.model",
    ],
    ["review", "approval", "Admin classification review"],
    ["commit", "capability", "Commit reviewed source route", "routes.commit"],
    ["receipt", "output", "Trust Receipt"],
  ].map(([id, kind, label, capability]) => ({
    id,
    kind,
    label,
    ...(capability ? { capability } : {}),
    retry: id === "classify" ? retryClassify : retryOnce,
  })),
  edges: [
    ["edge_start_classify", "start", "classify"],
    ["edge_classify_review", "classify", "review"],
    ["edge_review_commit", "review", "commit"],
    ["edge_commit_receipt", "commit", "receipt"],
  ].map(([id, sourceNodeId, targetNodeId]) => ({
    id,
    sourceNodeId,
    targetNodeId,
  })),
  joins: [],
} as DurableWorkflowGraph;
