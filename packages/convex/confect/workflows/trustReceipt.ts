import type { ContextManifest, EvidenceSnapshot } from "./evidence";
import type { WorkflowNodeKind } from "./graph";

export type TrustReceiptStage = {
  readonly nodeId: string;
  readonly label: string;
  readonly kind: WorkflowNodeKind;
  readonly status: "queued" | "running" | "completed" | "failed" | "skipped";
  readonly capability?: string;
  readonly agent?: string;
};

export type ProjectTrustReceiptInput = {
  readonly workflowRunId: string;
  readonly workflowName: string;
  readonly workspaceId: string;
  readonly status: "completed" | "failed";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly stageRuns: readonly TrustReceiptStage[];
  readonly evidenceSnapshots: readonly EvidenceSnapshot[];
  readonly contextManifest: ContextManifest;
  readonly claim: string;
};

export type TrustReceiptProjection = {
  readonly receiptId: string;
  readonly workflowRunId: string;
  readonly workflowName: string;
  readonly workspaceId: string;
  readonly status: "completed" | "failed";
  readonly startedAt: string;
  readonly completedAt: string;
  readonly claim: string;
  readonly sourceTitles: readonly string[];
  readonly evidenceHashes: readonly string[];
  readonly contextManifestHash: string;
  readonly policySnapshotId: string;
  readonly modelReceiptId: string;
  readonly trustClaim: "source-backed-no-default-rag";
  readonly stages: readonly TrustReceiptStage[];
};

export const projectTrustReceipt = (
  input: ProjectTrustReceiptInput,
): TrustReceiptProjection => {
  const sourceTitles = [
    ...new Set(
      input.evidenceSnapshots.flatMap((snapshot) => snapshot.sourceTitles),
    ),
  ].sort();
  const evidenceHashes = [
    ...new Set(
      input.evidenceSnapshots.map((snapshot) => snapshot.evidenceHash),
    ),
  ].sort();

  return {
    receiptId: `trust_${input.workflowRunId}`,
    workflowRunId: input.workflowRunId,
    workflowName: input.workflowName,
    workspaceId: input.workspaceId,
    status: input.status,
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    claim: input.claim,
    sourceTitles,
    evidenceHashes,
    contextManifestHash: input.contextManifest.manifestHash,
    policySnapshotId: input.contextManifest.policySnapshotId,
    modelReceiptId: input.contextManifest.modelReceiptId,
    trustClaim: "source-backed-no-default-rag",
    stages: input.stageRuns,
  };
};
