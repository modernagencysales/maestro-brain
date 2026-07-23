import type { DurableGraphCapabilityEnvelope } from "./_kit/graphRunner";
import type { DurableWorkflowGraph } from "./graph";

// prettier-ignore
export const buildMaintainBrainPageArgs = ({ inputs }: DurableGraphCapabilityEnvelope): Record<string, unknown> => {
  const source = inputs as { readonly workspaceId?: string; readonly idempotencyKey?: string };
  const workspaceId = source.workspaceId ?? "workspace_unknown";
  return {
    workspaceSlug: workspaceId,
    contextPackId: source.idempotencyKey ?? "context_pack_unknown",
    context: {
      workspaceId, brainKey: "br_client", pageKey: "pag_brief", currentRevisionKey: "rev_1", routeGeneration: 1,
      lifecycleGeneration: 1, policyGeneration: 1, modelId: "fake-maintenance-model", promptVersion: "maintenance-v1",
      modelPromptPair: "fake-maintenance-model@maintenance-v1", revisionBudget: 1,
      citations: [{ citationKey: "cite_1", sourceUnitKey: "unit_1", revisionKey: "src_rev_1", quote: "Routed evidence supports a Client Brief maintenance proposal." }],
    },
    modelOutput: {
      kind: "revision", title: "Client Brief", markdown: "# Client Brief\nRouted evidence supports a Client Brief maintenance proposal.",
      citationKeys: ["cite_1"], selfConfidence: 0.74,
    },
  };
};

// prettier-ignore
export const sourceToBrainMaintenanceGraph = {
  id: "workflow_sourceToBrainMaintenance",
  version: 1,
  startNodeId: "start",
  nodes: [
    { id: "start", kind: "source", label: "sourceToBrainMaintenance start", retry: { maxAttempts: 1, backoffMs: 0 } },
    { id: "maintainBrainPage", kind: "capability", label: "Maintain cited Brain page", capability: "capabilities.maintainBrainPage", retry: { maxAttempts: 1, backoffMs: 0 } },
    { id: "receipt", kind: "output", label: "Trust Receipt", retry: { maxAttempts: 1, backoffMs: 0 } },
  ],
  edges: [
    { id: "edge_start_maintainBrainPage", sourceNodeId: "start", targetNodeId: "maintainBrainPage" },
    { id: "edge_maintainBrainPage_receipt", sourceNodeId: "maintainBrainPage", targetNodeId: "receipt" },
  ],
  joins: [],
} satisfies DurableWorkflowGraph;
