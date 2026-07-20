export type MaintenanceProposalStatus =
  | "gathering"
  | "proposed_noop"
  | "accepted_noop"
  | "proposed_revision"
  | "awaiting_review"
  | "published"
  | "edited_and_published"
  | "rejected"
  | "superseded"
  | "revoked";

export type MaintenanceErrorName =
  | "CitationRequired"
  | "CitationNotInManifest"
  | "RevisionBudgetExceeded"
  | "AutopilotNotEligible"
  | "StaleRevision"
  | "LifecycleRevoked";

export class MaintenancePolicyError extends Error {
  override readonly name: MaintenanceErrorName;

  constructor(name: MaintenanceErrorName, message = name) {
    super(message);
    this.name = name;
  }
}

export type MaintenanceCitation = {
  readonly citationKey: string;
  readonly sourceUnitKey: string;
  readonly revisionKey: string;
  readonly quote: string;
};

export type MaintenanceContextPack = {
  readonly workspaceId: string;
  readonly brainKey: string;
  readonly pageKey: string;
  readonly currentRevisionKey: string;
  readonly routeGeneration: number;
  readonly lifecycleGeneration: number;
  readonly policyGeneration: number;
  readonly modelId: string;
  readonly promptVersion: string;
  readonly modelPromptPair: string;
  readonly revisionBudget: number;
  readonly citations: readonly MaintenanceCitation[];
  readonly routedUnitKeys?: readonly string[];
  readonly maxUnits?: number;
  readonly lifecycleState?: "active" | "revoked";
};

export type AutopilotPolicy = {
  readonly mode: "review_first" | "autopilot";
  readonly approvedPairs: readonly string[];
  readonly adminEnabled: boolean;
  readonly passingEvalReceipt?: boolean;
  readonly reviewedSampleCount?: number;
};

export const reviewFirstPolicy: AutopilotPolicy = {
  mode: "review_first",
  approvedPairs: [],
  adminEnabled: false,
};

const promptInjectionPattern =
  /(?:ignore|disregard|override) (?:prior|previous|above|system) instructions|publish without review|autopilot/i;

export const assertPromptInjectionFree = (text: string): void => {
  if (promptInjectionPattern.test(text)) {
    throw new MaintenancePolicyError("CitationNotInManifest");
  }
};

export const assertModelConfidence = (selfConfidence: number): void => {
  if (!Number.isFinite(selfConfidence) || selfConfidence < 0.4) {
    throw new MaintenancePolicyError("AutopilotNotEligible");
  }
};

export const requireActiveLifecycle = (
  context: MaintenanceContextPack,
): void => {
  if (context.lifecycleState === "revoked") {
    throw new MaintenancePolicyError("LifecycleRevoked");
  }
};

export const assertCitationMembership = (
  context: MaintenanceContextPack,
  citationKeys: readonly string[],
): void => {
  if (citationKeys.length === 0) {
    throw new MaintenancePolicyError("CitationRequired");
  }

  context.citations.forEach((citation) => {
    assertPromptInjectionFree(citation.quote);
  });

  const manifestKeys = new Set(
    context.citations.map((citation) => citation.citationKey),
  );
  if (citationKeys.some((citationKey) => !manifestKeys.has(citationKey))) {
    throw new MaintenancePolicyError("CitationNotInManifest");
  }
};

export const assertRevisionBudget = (context: MaintenanceContextPack): void => {
  if (context.revisionBudget < 1) {
    throw new MaintenancePolicyError("RevisionBudgetExceeded");
  }
};

export const assertAutopilotEligible = (
  context: MaintenanceContextPack,
  policy: AutopilotPolicy,
): void => {
  const eligible =
    policy.mode === "autopilot" &&
    policy.adminEnabled &&
    policy.passingEvalReceipt === true &&
    (policy.reviewedSampleCount ?? 0) > 0 &&
    policy.approvedPairs.includes(context.modelPromptPair);

  if (!eligible) {
    throw new MaintenancePolicyError("AutopilotNotEligible");
  }
};
