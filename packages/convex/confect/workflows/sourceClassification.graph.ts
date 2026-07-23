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
      "gather",
      "capability",
      "Gather immutable source unit request",
      "classification.gather",
    ],
    [
      "classify",
      "capability",
      "Classify immutable source unit",
      "classification.model",
    ],
    ["review", "approval", "Admin classification review"],
    [
      "currentAuthority",
      "capability",
      "Recheck current route authority",
      "classification.currentAuthority",
    ],
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
    ["edge_start_gather", "start", "gather"],
    ["edge_gather_classify", "gather", "classify"],
    ["edge_classify_review", "classify", "review"],
    ["edge_review_currentAuthority", "review", "currentAuthority"],
    ["edge_currentAuthority_commit", "currentAuthority", "commit"],
    ["edge_commit_receipt", "commit", "receipt"],
  ].map(([id, sourceNodeId, targetNodeId]) => ({
    id,
    sourceNodeId,
    targetNodeId,
  })),
  joins: [],
} as DurableWorkflowGraph;
