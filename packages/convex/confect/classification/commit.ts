export class StaleGeneration extends Error {
  override name = "StaleGeneration";
  constructor() {
    super("Classification generations are stale.");
  }
}
export class DuplicateEffect extends Error {
  override name = "DuplicateEffect";
  constructor(effectKey: string) {
    super("Classification route effect already exists: " + effectKey);
  }
}
export type CommitReadyClassification = {
  readonly decisionKey: string;
  readonly sourceUnitRevisionKey: string;
  readonly sourceUnitHash: string;
  readonly policyVersion: number;
  readonly lifecycleGeneration: number;
  readonly routeGeneration: number;
  readonly leaseGeneration: number;
  readonly state:
    | "accepted"
    | "changed_to_allowed"
    | "no_route"
    | "mixed_client_no_route"
    | "rejected";
  readonly targetBrainKey: string | null;
};
export type ClassificationCommitContext = {
  readonly expectedPolicyVersion: number;
  readonly expectedSourceUnitHash: string;
  readonly expectedLifecycleGeneration: number;
  readonly expectedRouteGeneration: number;
  readonly expectedLeaseGeneration: number;
  readonly existingRouteEffectKeys: ReadonlySet<string>;
};
export type ClassificationCommitResult =
  | {
      readonly stage: "routed";
      readonly routeEffectKey: string;
      readonly targetBrainKey: string;
    }
  | {
      readonly stage: "classified_no_route" | "mixed_client_no_route";
      readonly routeEffectKey: null;
      readonly targetBrainKey: null;
    };

const isCurrent = (
  decision: CommitReadyClassification,
  context: ClassificationCommitContext,
) =>
  decision.policyVersion === context.expectedPolicyVersion &&
  decision.sourceUnitHash === context.expectedSourceUnitHash &&
  decision.lifecycleGeneration === context.expectedLifecycleGeneration &&
  decision.routeGeneration === context.expectedRouteGeneration &&
  decision.leaseGeneration === context.expectedLeaseGeneration;
export const routeEffectKeyForDecision = (
  decision: CommitReadyClassification,
): string => {
  if (!decision.targetBrainKey) throw new StaleGeneration();
  return `route:${decision.decisionKey}:${decision.sourceUnitRevisionKey}:${decision.targetBrainKey}`;
};

export const commitReviewedClassification = (
  decision: CommitReadyClassification,
  context: ClassificationCommitContext,
): ClassificationCommitResult => {
  if (!isCurrent(decision, context)) throw new StaleGeneration();
  if (decision.state === "mixed_client_no_route") {
    return {
      stage: decision.state,
      routeEffectKey: null,
      targetBrainKey: null,
    };
  }
  if (decision.state === "no_route" || decision.state === "rejected") {
    return {
      stage: "classified_no_route",
      routeEffectKey: null,
      targetBrainKey: null,
    };
  }
  const routeEffectKey = routeEffectKeyForDecision(decision);
  if (context.existingRouteEffectKeys.has(routeEffectKey))
    throw new DuplicateEffect(routeEffectKey);
  if (!decision.targetBrainKey) throw new StaleGeneration();
  return {
    stage: "routed",
    routeEffectKey,
    targetBrainKey: decision.targetBrainKey,
  };
};
