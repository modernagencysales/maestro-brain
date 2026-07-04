import { runFakeSourceGroundedBrief } from "../capabilities/sourceGroundedBrief.fake";
import {
  normalizeSourceGroundedBriefInput,
  type SourceGroundedBriefInput,
  type SourceGroundedBriefResult,
} from "../capabilities/sourceGroundedBrief.domain";
import {
  buildContextManifest,
  createEvidenceSnapshot,
  type ContextManifest,
  type EvidenceSnapshot,
  type EvidenceSource,
} from "./evidence";
import {
  validateWorkflowGraph,
  type DurableWorkflowGraph,
  type WorkflowNode,
} from "./graph";
import { makePublicError } from "../shared/errors";
import {
  projectTrustReceipt,
  type TrustReceiptProjection,
  type TrustReceiptStage,
} from "./trustReceipt";

export type WorkflowRunRecord = {
  readonly workflowRunId: string;
  readonly workflowId: string;
  readonly workflowVersion: number;
  readonly workspaceId: string;
  readonly status: "completed";
  readonly startedByUserId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly trustReceiptId: string;
};

export type WorkflowStageRunRecord = TrustReceiptStage & {
  readonly workflowRunId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly outputJson: string;
};

export type WorkflowRunEventRecord = {
  readonly workflowRunId: string;
  readonly sequence: number;
  readonly type: string;
  readonly nodeId: string | null;
  readonly payloadJson: string;
  readonly createdAt: string;
};

export type RunWorkflowGraphInput = {
  readonly workflowRunId: string;
  readonly workflowName: string;
  readonly workspaceId: string;
  readonly startedByUserId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly graph: DurableWorkflowGraph;
  readonly capabilityInput: SourceGroundedBriefInput;
  readonly sources: readonly EvidenceSource[];
  readonly policySnapshotId: string;
  readonly modelReceiptId: string;
};

export type RunWorkflowGraphResult = {
  readonly run: WorkflowRunRecord;
  readonly stageRuns: readonly WorkflowStageRunRecord[];
  readonly events: readonly WorkflowRunEventRecord[];
  readonly evidenceSnapshot: EvidenceSnapshot;
  readonly contextManifest: ContextManifest;
  readonly capabilityResult: SourceGroundedBriefResult;
  readonly trustReceipt: TrustReceiptProjection;
};

export const runWorkflowGraph = async (
  input: RunWorkflowGraphInput,
): Promise<RunWorkflowGraphResult> => {
  const validationErrors = validateWorkflowGraph(input.graph);

  if (validationErrors.length > 0) {
    throw makePublicError("VALIDATION_FAILED", "Workflow graph is invalid.");
  }

  const startNode = input.graph.nodes.find(
    (node) => node.id === input.graph.startNodeId,
  );

  if (!startNode) {
    throw makePublicError("VALIDATION_FAILED", "Workflow graph is invalid.");
  }

  const events: WorkflowRunEventRecord[] = [
    event(input, 1, "workflow.started", null, {
      workflowId: input.graph.id,
      workflowVersion: input.graph.version,
    }),
    event(input, 2, "stage.started", startNode.id, {
      label: startNode.label,
    }),
  ];
  const capabilityResult = runCapabilityNode(input, startNode);
  const evidenceSnapshot = await createEvidenceSnapshot({
    workflowRunId: input.workflowRunId,
    sources: input.sources,
    materiality: "required",
    createdAt: Date.parse(input.completedAt),
  });
  const contextManifest = await buildContextManifest({
    workflowRunId: input.workflowRunId,
    evidenceSnapshotIds: [evidenceSnapshot.evidenceHash],
    policySnapshotId: input.policySnapshotId,
    promptRef: "prompt:source-grounded-brief:v1",
    modelReceiptId: input.modelReceiptId,
    createdAt: Date.parse(input.completedAt),
  });
  const stageRuns: readonly WorkflowStageRunRecord[] = [
    withCapability(
      {
        workflowRunId: input.workflowRunId,
        nodeId: startNode.id,
        label: startNode.label,
        kind: startNode.kind,
        status: "completed",
        startedAt: input.startedAt,
        completedAt: input.completedAt,
        outputJson: JSON.stringify(capabilityResult),
      },
      startNode.capability,
    ),
  ];
  const trustReceipt = projectTrustReceipt({
    workflowRunId: input.workflowRunId,
    workflowName: input.workflowName,
    workspaceId: input.workspaceId,
    status: "completed",
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    stageRuns,
    evidenceSnapshots: [evidenceSnapshot],
    contextManifest,
    claim:
      "The workflow produced a source-grounded brief from approved sources.",
  });

  events.push(
    event(input, 3, "stage.completed", startNode.id, {
      status: "completed",
      ...(startNode.capability ? { capability: startNode.capability } : {}),
    }),
    event(input, 4, "trust_receipt.created", null, {
      receiptId: trustReceipt.receiptId,
    }),
    event(input, 5, "workflow.completed", null, {
      status: "completed",
    }),
  );

  return {
    run: {
      workflowRunId: input.workflowRunId,
      workflowId: input.graph.id,
      workflowVersion: input.graph.version,
      workspaceId: input.workspaceId,
      status: "completed",
      startedByUserId: input.startedByUserId,
      startedAt: input.startedAt,
      completedAt: input.completedAt,
      trustReceiptId: trustReceipt.receiptId,
    },
    stageRuns,
    events,
    evidenceSnapshot,
    contextManifest,
    capabilityResult,
    trustReceipt,
  };
};

const runCapabilityNode = (
  input: RunWorkflowGraphInput,
  node: WorkflowNode,
): SourceGroundedBriefResult => {
  if (node.kind !== "capability") {
    throw makePublicError(
      "VALIDATION_FAILED",
      `Unsupported workflow node kind: ${node.kind}`,
    );
  }

  if (node.capability !== "sourceGroundedBrief") {
    throw makePublicError(
      "VALIDATION_FAILED",
      `Unsupported workflow capability: ${node.capability}`,
    );
  }

  const normalizedInput = normalizeSourceGroundedBriefInput(
    input.capabilityInput,
  );

  return runFakeSourceGroundedBrief({
    input: normalizedInput,
    sources: input.sources.map((source) => ({
      id: source.id,
      title: source.title,
      markdown: source.content,
    })),
    policySnapshotId: input.policySnapshotId,
    modelReceiptId: input.modelReceiptId,
  });
};

const event = (
  input: RunWorkflowGraphInput,
  sequence: number,
  type: string,
  nodeId: string | null,
  payload: Record<string, string | number>,
): WorkflowRunEventRecord => ({
  workflowRunId: input.workflowRunId,
  sequence,
  type,
  nodeId,
  payloadJson: JSON.stringify(payload),
  createdAt: input.completedAt,
});

const withCapability = <Record_ extends WorkflowStageRunRecord>(
  record: Omit<Record_, "capability">,
  capability: string | undefined,
): Record_ => (capability ? { ...record, capability } : record) as Record_;
