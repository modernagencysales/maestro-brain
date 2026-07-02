import { stableFingerprint } from "../shared/tokenCrypto";

export type EvidenceSourceKind = "markdown" | "link" | "note";

export type EvidenceSource = {
  readonly id: string;
  readonly title: string;
  readonly kind: EvidenceSourceKind;
  readonly content: string;
};

export type EvidenceMateriality = "required" | "supporting" | "excluded";

export type EvidenceSnapshot = {
  readonly workflowRunId: string;
  readonly sourceIds: readonly string[];
  readonly sourceTitles: readonly string[];
  readonly evidenceHash: string;
  readonly materiality: EvidenceMateriality;
  readonly snapshotJson: string;
  readonly createdAt: number;
};

export type ContextManifest = {
  readonly workflowRunId: string;
  readonly manifestHash: string;
  readonly sourceSnapshotIds: readonly string[];
  readonly policySnapshotId: string;
  readonly promptRef: string;
  readonly modelReceiptId: string;
  readonly manifestJson: string;
  readonly createdAt: number;
};

export type CreateEvidenceSnapshotInput = {
  readonly workflowRunId: string;
  readonly sources: readonly EvidenceSource[];
  readonly materiality: EvidenceMateriality;
  readonly createdAt: number;
};

export type BuildContextManifestInput = {
  readonly workflowRunId: string;
  readonly evidenceSnapshotIds: readonly string[];
  readonly policySnapshotId: string;
  readonly promptRef: string;
  readonly modelReceiptId: string;
  readonly createdAt: number;
};

export const fingerprintEvidence = async (
  sources: readonly EvidenceSource[],
): Promise<string> => stableFingerprint({ sources: normalizeSources(sources) });

export const createEvidenceSnapshot = async (
  input: CreateEvidenceSnapshotInput,
): Promise<EvidenceSnapshot> => {
  const sources = normalizeSources(input.sources);
  const evidenceHash = await stableFingerprint({ sources });
  const snapshotPayload = {
    materiality: input.materiality,
    sources,
  };

  return {
    workflowRunId: input.workflowRunId,
    sourceIds: sources.map((source) => source.id),
    sourceTitles: sources.map((source) => source.title),
    evidenceHash,
    materiality: input.materiality,
    snapshotJson: JSON.stringify(snapshotPayload),
    createdAt: input.createdAt,
  };
};

export const buildContextManifest = async (
  input: BuildContextManifestInput,
): Promise<ContextManifest> => {
  const sourceSnapshotIds = [...input.evidenceSnapshotIds].sort();
  const manifestPayload = {
    modelReceiptId: input.modelReceiptId,
    policySnapshotId: input.policySnapshotId,
    promptRef: input.promptRef,
    sourceSnapshotIds,
  };
  const manifestHash = await stableFingerprint(manifestPayload);

  return {
    workflowRunId: input.workflowRunId,
    manifestHash,
    sourceSnapshotIds,
    policySnapshotId: input.policySnapshotId,
    promptRef: input.promptRef,
    modelReceiptId: input.modelReceiptId,
    manifestJson: JSON.stringify(manifestPayload),
    createdAt: input.createdAt,
  };
};

const normalizeSources = (
  sources: readonly EvidenceSource[],
): readonly EvidenceSource[] =>
  [...sources]
    .map((source) => ({
      id: source.id.trim(),
      title: source.title.trim(),
      kind: source.kind,
      content: source.content.trim(),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
