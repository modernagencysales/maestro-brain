export type TransformPolicyKind =
  "none" | "approval-required" | "review-required";

export type TransformBlockKind =
  "input" | "retrieval" | "model-output" | "postprocess" | "external-write";

export type TransformDefinition = {
  readonly transformId: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly inputSchemaRef: string;
  readonly outputSchemaRef: string;
  readonly policyKind: TransformPolicyKind;
  readonly requiredEvidence: readonly string[];
  readonly createdAt: string;
};

export type TransformBlock = {
  readonly runId: string;
  readonly blockId: string;
  readonly workspaceId: string;
  readonly transformId: string;
  readonly kind: TransformBlockKind;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly sourceIds: readonly string[];
  readonly citationIds: readonly string[];
  readonly policySnapshotId: string;
  readonly modelReceiptId: string;
  readonly createdAt: string;
};

export type TransformAlertPayload = {
  readonly severity: "info" | "warning" | "critical";
  readonly title: string;
  readonly body: string;
  readonly dedupeKey: string;
  readonly workspaceId: string;
  readonly metadata: Readonly<Record<string, unknown>>;
};

export type TransformTrustReceiptProjection = {
  readonly receiptId: string;
  readonly runId: string;
  readonly workspaceId: string;
  readonly transformId: string;
  readonly sourceIds: readonly string[];
  readonly citationIds: readonly string[];
  readonly inputHashes: readonly string[];
  readonly outputHashes: readonly string[];
  readonly policySnapshotIds: readonly string[];
  readonly modelReceiptIds: readonly string[];
  readonly trustClaim: "source-backed-transform";
  readonly createdAt: string;
};

export class TransformValidationError extends Error {
  readonly _tag = "TransformValidationError";

  constructor(
    readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "TransformValidationError";
  }
}

const requireNonEmpty = (field: string, value: string): void => {
  if (!value.trim()) {
    throw new TransformValidationError(field, `${field} is required.`);
  }
};

const requireNonEmptyList = (
  field: string,
  values: readonly string[],
): void => {
  if (values.length === 0 || values.some((value) => !value.trim())) {
    throw new TransformValidationError(
      field,
      `${field} must contain at least one non-empty value.`,
    );
  }
};

const dedupe = (values: readonly string[]): readonly string[] => [
  ...new Set(values.map((value) => value.trim()).filter(Boolean)),
];

const policyKinds = new Set<TransformPolicyKind>([
  "none",
  "approval-required",
  "review-required",
]);

const blockKinds = new Set<TransformBlockKind>([
  "input",
  "retrieval",
  "model-output",
  "postprocess",
  "external-write",
]);

const assertPolicyKind = (policyKind: string): TransformPolicyKind => {
  if (!policyKinds.has(policyKind as TransformPolicyKind)) {
    throw new TransformValidationError(
      "policyKind",
      "transform policy kind is invalid.",
    );
  }

  return policyKind as TransformPolicyKind;
};

const assertBlockKind = (kind: string): TransformBlockKind => {
  if (!blockKinds.has(kind as TransformBlockKind)) {
    throw new TransformValidationError(
      "kind",
      "transform block kind is invalid.",
    );
  }

  return kind as TransformBlockKind;
};

export const createTransformDefinition = (input: {
  readonly transformId: string;
  readonly workspaceId: string;
  readonly name: string;
  readonly inputSchemaRef: string;
  readonly outputSchemaRef: string;
  readonly policyKind: string;
  readonly requiredEvidence: readonly string[];
  readonly createdAt: string;
}): TransformDefinition => {
  requireNonEmpty("transformId", input.transformId);
  requireNonEmpty("workspaceId", input.workspaceId);
  requireNonEmpty("name", input.name);
  requireNonEmpty("inputSchemaRef", input.inputSchemaRef);
  requireNonEmpty("outputSchemaRef", input.outputSchemaRef);
  requireNonEmptyList("requiredEvidence", input.requiredEvidence);

  return {
    transformId: input.transformId,
    workspaceId: input.workspaceId,
    name: input.name,
    inputSchemaRef: input.inputSchemaRef,
    outputSchemaRef: input.outputSchemaRef,
    policyKind: assertPolicyKind(input.policyKind),
    requiredEvidence: dedupe(input.requiredEvidence),
    createdAt: input.createdAt,
  };
};

export const traceTransformBlock = (input: {
  readonly runId: string;
  readonly blockId: string;
  readonly workspaceId: string;
  readonly transformId: string;
  readonly kind: string;
  readonly inputHash: string;
  readonly outputHash: string;
  readonly sourceIds: readonly string[];
  readonly citationIds: readonly string[];
  readonly policySnapshotId: string;
  readonly modelReceiptId: string;
  readonly createdAt: string;
}): TransformBlock => {
  requireNonEmpty("runId", input.runId);
  requireNonEmpty("blockId", input.blockId);
  requireNonEmpty("workspaceId", input.workspaceId);
  requireNonEmpty("transformId", input.transformId);
  requireNonEmpty("inputHash", input.inputHash);
  requireNonEmpty("outputHash", input.outputHash);
  requireNonEmptyList("sourceIds", input.sourceIds);
  requireNonEmptyList("citationIds", input.citationIds);
  requireNonEmpty("policySnapshotId", input.policySnapshotId);
  requireNonEmpty("modelReceiptId", input.modelReceiptId);

  return {
    runId: input.runId,
    blockId: input.blockId,
    workspaceId: input.workspaceId,
    transformId: input.transformId,
    kind: assertBlockKind(input.kind),
    inputHash: input.inputHash,
    outputHash: input.outputHash,
    sourceIds: dedupe(input.sourceIds),
    citationIds: dedupe(input.citationIds),
    policySnapshotId: input.policySnapshotId,
    modelReceiptId: input.modelReceiptId,
    createdAt: input.createdAt,
  };
};

export const buildTransformDriftAlert = (input: {
  readonly workspaceId: string;
  readonly transformId: string;
  readonly runId: string;
  readonly expectedOutputHash: string;
  readonly actualOutputHash: string;
  readonly severity: "info" | "warning" | "critical";
}): TransformAlertPayload => {
  requireNonEmpty("workspaceId", input.workspaceId);
  requireNonEmpty("transformId", input.transformId);
  requireNonEmpty("runId", input.runId);

  return {
    severity: input.severity,
    title: "Transform drift detected",
    body: `Transform ${input.transformId} drifted for run ${input.runId}.`,
    dedupeKey: `transform-drift:${input.workspaceId}:${input.transformId}:${input.runId}`,
    workspaceId: input.workspaceId,
    metadata: {
      transformId: input.transformId,
      runId: input.runId,
      expectedOutputHash: "[redacted]",
      actualOutputHash: "[redacted]",
    },
  };
};

export const projectTransformTrustReceipt = (input: {
  readonly runId: string;
  readonly workspaceId: string;
  readonly transformId: string;
  readonly blocks: readonly TransformBlock[];
  readonly createdAt: string;
}): TransformTrustReceiptProjection => {
  requireNonEmpty("runId", input.runId);
  requireNonEmpty("workspaceId", input.workspaceId);
  requireNonEmpty("transformId", input.transformId);

  if (input.blocks.length === 0) {
    throw new TransformValidationError(
      "blocks",
      "trust receipt projection requires traced blocks.",
    );
  }

  return {
    receiptId: `trust_transform_${input.runId}`,
    runId: input.runId,
    workspaceId: input.workspaceId,
    transformId: input.transformId,
    sourceIds: dedupe(input.blocks.flatMap((block) => block.sourceIds)),
    citationIds: dedupe(input.blocks.flatMap((block) => block.citationIds)),
    inputHashes: dedupe(input.blocks.map((block) => block.inputHash)),
    outputHashes: dedupe(input.blocks.map((block) => block.outputHash)),
    policySnapshotIds: dedupe(
      input.blocks.map((block) => block.policySnapshotId),
    ),
    modelReceiptIds: dedupe(input.blocks.map((block) => block.modelReceiptId)),
    trustClaim: "source-backed-transform",
    createdAt: input.createdAt,
  };
};
