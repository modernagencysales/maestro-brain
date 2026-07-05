import { describe, expect, it } from "vitest";
import type { DurableWorkflowGraph } from "../confect/workflows/graph";
import { runWorkflowGraph } from "../confect/workflows/runGraph";

const graph = {
  id: "workflow_source_grounded_plan",
  version: 1,
  startNodeId: "brief",
  nodes: [
    {
      id: "brief",
      kind: "capability",
      label: "Source Grounded Brief",
      capability: "sourceGroundedBrief",
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
  ],
  edges: [],
  joins: [],
} satisfies DurableWorkflowGraph;

const capabilityNode = graph.nodes[0];

if (!capabilityNode) {
  throw new Error("graph must include the sourceGroundedBrief capability node");
}

describe("workflow graph runner", () => {
  it("runs a graph that calls sourceGroundedBrief and records workflow state", async () => {
    await expect(
      runWorkflowGraph({
        workflowRunId: "run_123",
        workflowName: "Source grounded planning workflow",
        workspaceId: "workspace_123",
        startedByUserId: "user_123",
        startedAt: "2026-07-01T14:00:00.000Z",
        completedAt: "2026-07-01T14:03:12.000Z",
        graph,
        capabilityInput: {
          workspaceId: "workspace_123",
          sourceIds: ["source_1"],
          briefGoal: "Create a source-grounded implementation brief.",
          idempotencyKey: "brief-001",
        },
        sources: [
          {
            id: "source_1",
            title: "Founder interview notes",
            kind: "markdown",
            content: "Trusted founder notes.",
          },
        ],
        policySnapshotId: "policy_snapshot_123",
        modelReceiptId: "model_receipt_123",
      }),
    ).resolves.toMatchObject({
      run: {
        workflowRunId: "run_123",
        workflowId: "workflow_source_grounded_plan",
        workflowVersion: 1,
        workspaceId: "workspace_123",
        status: "completed",
        trustReceiptId: "trust_run_123",
      },
      stageRuns: [
        {
          nodeId: "brief",
          kind: "capability",
          status: "completed",
          capability: "sourceGroundedBrief",
        },
      ],
      events: [
        { sequence: 1, type: "workflow.started", nodeId: null },
        { sequence: 2, type: "stage.started", nodeId: "brief" },
        { sequence: 3, type: "stage.completed", nodeId: "brief" },
        { sequence: 4, type: "trust_receipt.created", nodeId: null },
        { sequence: 5, type: "workflow.completed", nodeId: null },
      ],
      capabilityResult: {
        sourceTitles: ["Founder interview notes"],
        trustClaim: "source-backed-no-default-rag",
      },
      trustReceipt: {
        receiptId: "trust_run_123",
        sourceTitles: ["Founder interview notes"],
        policySnapshotId: "policy_snapshot_123",
        modelReceiptId: "model_receipt_123",
        trustClaim: "source-backed-no-default-rag",
      },
    });
  });

  it("rejects invalid graphs before running capabilities", async () => {
    await expect(
      runWorkflowGraph({
        workflowRunId: "run_123",
        workflowName: "Broken workflow",
        workspaceId: "workspace_123",
        startedByUserId: "user_123",
        startedAt: "2026-07-01T14:00:00.000Z",
        completedAt: "2026-07-01T14:03:12.000Z",
        graph: { ...graph, startNodeId: "missing" },
        capabilityInput: {
          workspaceId: "workspace_123",
          sourceIds: ["source_1"],
          briefGoal: "Create a source-grounded implementation brief.",
          idempotencyKey: "brief-001",
        },
        sources: [
          {
            id: "source_1",
            title: "Founder interview notes",
            kind: "markdown",
            content: "Trusted founder notes.",
          },
        ],
        policySnapshotId: "policy_snapshot_123",
        modelReceiptId: "model_receipt_123",
      }),
    ).rejects.toThrow("Workflow graph is invalid.");
  });

  it("rejects invalid capability idempotency keys before running workflow capabilities", async () => {
    await expect(
      runWorkflowGraph({
        workflowRunId: "run_123",
        workflowName: "Source grounded planning workflow",
        workspaceId: "workspace_123",
        startedByUserId: "user_123",
        startedAt: "2026-07-01T14:00:00.000Z",
        completedAt: "2026-07-01T14:03:12.000Z",
        graph,
        capabilityInput: {
          workspaceId: "workspace_123",
          sourceIds: ["source_1"],
          briefGoal: "Create a source-grounded implementation brief.",
          idempotencyKey: " brief-001 ",
        },
        sources: [
          {
            id: "source_1",
            title: "Founder interview notes",
            kind: "markdown",
            content: "Trusted founder notes.",
          },
        ],
        policySnapshotId: "policy_snapshot_123",
        modelReceiptId: "model_receipt_123",
      }),
    ).rejects.toThrow(
      "idempotencyKey must not have leading or trailing whitespace.",
    );
  });

  it("rejects unsupported capability nodes explicitly", async () => {
    await expect(
      runWorkflowGraph({
        workflowRunId: "run_123",
        workflowName: "Unsupported workflow",
        workspaceId: "workspace_123",
        startedByUserId: "user_123",
        startedAt: "2026-07-01T14:00:00.000Z",
        completedAt: "2026-07-01T14:03:12.000Z",
        graph: {
          ...graph,
          nodes: [
            {
              ...capabilityNode,
              capability: "unsupportedCapability",
            },
          ],
        },
        capabilityInput: {
          workspaceId: "workspace_123",
          sourceIds: ["source_1"],
          briefGoal: "Create a source-grounded implementation brief.",
          idempotencyKey: "brief-001",
        },
        sources: [
          {
            id: "source_1",
            title: "Founder interview notes",
            kind: "markdown",
            content: "Trusted founder notes.",
          },
        ],
        policySnapshotId: "policy_snapshot_123",
        modelReceiptId: "model_receipt_123",
      }),
    ).rejects.toThrow("Unsupported workflow capability: unsupportedCapability");
  });
});
