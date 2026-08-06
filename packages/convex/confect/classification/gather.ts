export type ClassificationPolicyMode = "direct" | "classify" | "capture_only";
export type ClassificationMessage = {
  readonly sourceRevisionKey: string;
  readonly authorLabel: string;
  readonly providerTimestamp: string;
  readonly canonicalText: string;
};
export type ClassificationTarget = {
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly brainKey: string;
  readonly displayName: string;
  readonly routingDescription?: string | undefined;
};
export type SourceUnitForClassification = {
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly sourceUnitRevisionKey: string;
  readonly sourceUnitHash: string;
  readonly policyVersion: number;
  readonly lifecycleGeneration: number;
  readonly routeGeneration: number;
  readonly leaseGeneration: number;
  readonly messages: readonly ClassificationMessage[];
};
export type ClassificationAuthoritySnapshot = {
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly policyVersion: number;
  readonly lifecycleGeneration: number;
  readonly routeGeneration: number;
  readonly leaseGeneration: number;
};
export type ClassificationRequest = SourceUnitForClassification & {
  readonly allowedTargets: readonly ClassificationTarget[];
  readonly authority: ClassificationAuthoritySnapshot;
};
export type GatherClassificationResult =
  | { readonly skipped: "not_classify_policy"; readonly modelCalls: 0 }
  | { readonly request: ClassificationRequest; readonly modelCalls: 1 };

export class ClassificationTenantMismatch extends Error {
  override name = "ClassificationTenantMismatch";
  constructor() {
    super("Classification request is not tenant-bound.");
  }
}

// prettier-ignore
const matchesAuthority = (sourceUnit: SourceUnitForClassification, authority: ClassificationAuthoritySnapshot) => sourceUnit.workspaceId === authority.workspaceId && sourceUnit.organizationId === authority.organizationId && sourceUnit.policyVersion === authority.policyVersion && sourceUnit.lifecycleGeneration === authority.lifecycleGeneration && sourceUnit.routeGeneration === authority.routeGeneration && sourceUnit.leaseGeneration === authority.leaseGeneration;

export const gatherClassificationRequest = ({
  allowedTargets,
  authority,
  policyMode,
  sourceUnit,
}: {
  readonly allowedTargets: readonly ClassificationTarget[];
  readonly authority: ClassificationAuthoritySnapshot;
  readonly policyMode: ClassificationPolicyMode;
  readonly sourceUnit: SourceUnitForClassification;
}): GatherClassificationResult => {
  if (policyMode !== "classify")
    return { skipped: "not_classify_policy", modelCalls: 0 };
  // prettier-ignore
  if (!matchesAuthority(sourceUnit, authority) || allowedTargets.some((target) => target.organizationId !== authority.organizationId)) throw new ClassificationTenantMismatch();
  return {
    modelCalls: 1,
    request: { ...sourceUnit, allowedTargets, authority },
  };
};
