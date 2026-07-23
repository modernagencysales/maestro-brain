import type { ClassificationRequest } from "./gather";

export class MalformedModelOutput extends Error {
  override name = "MalformedModelOutput";
  constructor(message: string) {
    super(message);
  }
}
export class TargetNotAllowed extends Error {
  override name = "TargetNotAllowed";
  constructor(targetBrainKey: string) {
    super(
      `Classification target is not in the pinned allowlist: ${targetBrainKey}`,
    );
  }
}
export class EvidenceMismatch extends Error {
  override name = "EvidenceMismatch";
  constructor() {
    super(
      "Classification evidence quote is not present in the immutable source unit.",
    );
  }
}

export type ClassificationContentScope =
  "single_target" | "mixed_client" | "no_target";
export type ClassificationModelOutput = {
  readonly sourceUnitRevisionKey: string;
  readonly sourceUnitHash: string;
  readonly contentScope: ClassificationContentScope;
  readonly targetBrainKey: string | null;
  readonly confidence: number;
  readonly rationale: string;
  readonly evidenceQuotes: readonly {
    readonly sourceRevisionKey: string;
    readonly quote: string;
  }[];
};
export type ClassificationDecisionState =
  | "proposed_zero"
  | "proposed_one"
  | "proposed_mixed"
  | "accepted"
  | "changed_to_allowed"
  | "no_route"
  | "mixed_client_no_route"
  | "rejected"
  | "superseded";
export type ClassificationDecision = ClassificationModelOutput & {
  readonly workspaceId: string;
  readonly organizationId: string;
  readonly decisionKey: string;
  readonly policyVersion: number;
  readonly lifecycleGeneration: number;
  readonly routeGeneration: number;
  readonly leaseGeneration: number;
  readonly allowedTargetKeys: readonly string[];
  readonly state: ClassificationDecisionState;
  readonly routeEffect: null;
};

const stateForScope = (
  scope: ClassificationContentScope,
): ClassificationDecisionState =>
  scope === "single_target"
    ? "proposed_one"
    : scope === "mixed_client"
      ? "proposed_mixed"
      : "proposed_zero";
const assertStructuralOutput = (output: ClassificationModelOutput) => {
  if (
    !["single_target", "mixed_client", "no_target"].includes(
      output.contentScope,
    )
  ) {
    throw new MalformedModelOutput("Unknown classification contentScope.");
  }
  if (Array.isArray(output.targetBrainKey)) {
    throw new MalformedModelOutput(
      "Classification must return zero or one target.",
    );
  }
  if (output.contentScope === "single_target" && !output.targetBrainKey) {
    throw new MalformedModelOutput(
      "single_target requires one targetBrainKey.",
    );
  }
  if (
    output.contentScope !== "single_target" &&
    output.targetBrainKey !== null
  ) {
    throw new MalformedModelOutput(
      "mixed_client and no_target require a null targetBrainKey.",
    );
  }
  if (
    !Number.isFinite(output.confidence) ||
    output.confidence < 0 ||
    output.confidence > 1
  ) {
    throw new MalformedModelOutput(
      "confidence must be diagnostic value from 0 to 1.",
    );
  }
};

// prettier-ignore
const assertTenantBoundRequest = (request: ClassificationRequest) => { const { authority } = request; if (request.workspaceId !== authority.workspaceId || request.organizationId !== authority.organizationId || request.policyVersion !== authority.policyVersion || request.lifecycleGeneration !== authority.lifecycleGeneration || request.routeGeneration !== authority.routeGeneration || request.leaseGeneration !== authority.leaseGeneration || request.allowedTargets.some((target) => target.workspaceId !== authority.workspaceId || target.organizationId !== authority.organizationId)) throw new MalformedModelOutput("Classification request must be tenant-bound to the authority snapshot."); };
const assertEvidence = (
  request: ClassificationRequest,
  quotes: ClassificationModelOutput["evidenceQuotes"],
) => {
  for (const evidence of quotes) {
    const message = request.messages.find(
      ({ sourceRevisionKey }) =>
        sourceRevisionKey === evidence.sourceRevisionKey,
    );
    if (
      !message ||
      !evidence.quote ||
      !message.canonicalText.includes(evidence.quote)
    ) {
      throw new EvidenceMismatch();
    }
  }
};

export const validateClassificationProposal = (
  request: ClassificationRequest,
  output: ClassificationModelOutput,
): ClassificationDecision => {
  assertTenantBoundRequest(request);
  if (output.sourceUnitRevisionKey !== request.sourceUnitRevisionKey) {
    throw new MalformedModelOutput(
      "sourceUnitRevisionKey does not match request.",
    );
  }
  if (output.sourceUnitHash !== request.sourceUnitHash) {
    throw new MalformedModelOutput("sourceUnitHash does not match request.");
  }
  assertStructuralOutput(output);
  if (
    output.targetBrainKey &&
    !request.allowedTargets.some(
      ({ brainKey }) => brainKey === output.targetBrainKey,
    )
  ) {
    throw new TargetNotAllowed(output.targetBrainKey);
  }
  assertEvidence(request, output.evidenceQuotes);
  return {
    ...output,
    workspaceId: request.workspaceId,
    organizationId: request.organizationId,
    decisionKey: `classification:${request.sourceUnitRevisionKey}:${request.policyVersion}`,
    policyVersion: request.policyVersion,
    lifecycleGeneration: request.lifecycleGeneration,
    routeGeneration: request.routeGeneration,
    leaseGeneration: request.leaseGeneration,
    allowedTargetKeys: request.allowedTargets.map(({ brainKey }) => brainKey),
    state: stateForScope(output.contentScope),
    routeEffect: null,
  };
};
