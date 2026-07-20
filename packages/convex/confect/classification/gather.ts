export type ClassificationPolicyMode = "direct" | "classify" | "capture_only";
export type ClassificationMessage = {
  readonly sourceRevisionKey: string;
  readonly authorLabel: string;
  readonly providerTimestamp: string;
  readonly canonicalText: string;
};
export type ClassificationTarget = {
  readonly brainKey: string;
  readonly displayName: string;
  readonly routingDescription?: string | undefined;
};
export type SourceUnitForClassification = {
  readonly sourceUnitRevisionKey: string;
  readonly sourceUnitHash: string;
  readonly policyVersion: number;
  readonly messages: readonly ClassificationMessage[];
};
export type ClassificationRequest = SourceUnitForClassification & {
  readonly allowedTargets: readonly ClassificationTarget[];
};
export type GatherClassificationResult =
  | { readonly skipped: "not_classify_policy"; readonly modelCalls: 0 }
  | { readonly request: ClassificationRequest; readonly modelCalls: 1 };

export const gatherClassificationRequest = ({
  allowedTargets,
  policyMode,
  sourceUnit,
}: {
  readonly allowedTargets: readonly ClassificationTarget[];
  readonly policyMode: ClassificationPolicyMode;
  readonly sourceUnit: SourceUnitForClassification;
}): GatherClassificationResult =>
  policyMode !== "classify"
    ? { skipped: "not_classify_policy", modelCalls: 0 }
    : { modelCalls: 1, request: { ...sourceUnit, allowedTargets } };
