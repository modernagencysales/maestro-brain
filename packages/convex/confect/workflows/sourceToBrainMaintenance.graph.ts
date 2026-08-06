import type { DurableGraphCapabilityEnvelope } from "./_kit/graphRunner";
import type { DurableWorkflowGraph } from "./graph";

const caller = {
  kind: "system" as const,
  name: "sourceToBrainMaintenance",
  surface: "workflow" as const,
};
type Inputs = {
  readonly workspaceId: string;
  readonly idempotencyKey: string;
  readonly unitRevisionKey: string;
};

export const buildGatherMaintenanceContextArgs = ({
  inputs,
}: DurableGraphCapabilityEnvelope): Record<string, unknown> => {
  const source = inputs as Inputs;
  return {
    workspaceId: source.workspaceId,
    unitRevisionKey: source.unitRevisionKey,
    caller,
  };
};

export const buildMineCallTranscriptArgs = ({
  inputs,
  context,
}: DurableGraphCapabilityEnvelope): Record<string, unknown> => ({
  context: context.gatherMaintenanceContext,
  attemptKey: (inputs as Inputs).idempotencyKey,
  caller,
});

export const buildMaintainBrainPageArgs = ({
  inputs,
  context,
}: DurableGraphCapabilityEnvelope): Record<string, unknown> => {
  const source = inputs as Inputs;
  return {
    workspaceSlug: source.workspaceId,
    contextPackId: source.idempotencyKey,
    context: context.gatherMaintenanceContext,
    modelOutput: context.mineCallTranscript,
    caller,
  };
};

export const sourceToBrainMaintenanceGraph = {
  id: "workflow_sourceToBrainMaintenance",
  version: 2,
  startNodeId: "start",
  nodes: [
    {
      id: "start",
      kind: "source",
      label: "sourceToBrainMaintenance start",
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: "gatherMaintenanceContext",
      kind: "capability",
      label: "Gather routed call evidence",
      capability: "capabilities.gatherMaintenanceContext",
      retry: { maxAttempts: 1, backoffMs: 0 },
    },
    {
      id: "mineCallTranscript",
      kind: "capability",
      label: "Mine cited call evidence",
      capability: "capabilities.mineCallTranscript",
      retry: { maxAttempts: 2, backoffMs: 1_000 },
    },
    {
      id: "maintainBrainPage",
      kind: "capability",
      label: "Persist cited Brain maintenance proposal",
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
      id: "edge_start_gatherMaintenanceContext",
      sourceNodeId: "start",
      targetNodeId: "gatherMaintenanceContext",
    },
    {
      id: "edge_gatherMaintenanceContext_mineCallTranscript",
      sourceNodeId: "gatherMaintenanceContext",
      targetNodeId: "mineCallTranscript",
    },
    {
      id: "edge_mineCallTranscript_maintainBrainPage",
      sourceNodeId: "mineCallTranscript",
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
