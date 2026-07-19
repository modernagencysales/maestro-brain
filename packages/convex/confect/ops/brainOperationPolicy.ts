export const operationSubsystems = [
  "capture",
  "backfill",
  "classification",
  "maintenance",
  "ask",
  "slackDelivery",
  "mcp",
  "export",
  "lifecycle",
] as const;

export type OperationSubsystem = (typeof operationSubsystems)[number];
export type OperationPolicyState = "enabled" | "paused" | "disabled";
export type OperatorRole = "viewer" | "editor" | "admin" | "owner";

export type OperationPolicy = {
  readonly subsystem: OperationSubsystem;
  readonly state: OperationPolicyState;
  readonly generation: number;
  readonly ownerUserId?: string;
  readonly reason?: string;
  readonly expiresAt?: number;
};

export type OperationPolicyInput = {
  readonly current: OperationPolicy;
  readonly requestedState: OperationPolicyState;
  readonly actorRole: OperatorRole;
  readonly reason: string;
  readonly ownerUserId: string;
  readonly expectedGeneration?: number;
  readonly expiresAt?: number;
  readonly now: number;
};

export type OperationPolicyDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly errorTag: "SubsystemDisabled" | "RecoveryGenerationMismatch";
    };

const operatorRank: Record<OperatorRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

const requireOperator = (role: OperatorRole): void => {
  if (operatorRank[role] < operatorRank.admin) {
    throw new Error("OperatorForbidden");
  }
};

export const nextOperationPolicy = ({
  current,
  requestedState,
  actorRole,
  reason,
  ownerUserId,
  expectedGeneration,
  expiresAt,
}: OperationPolicyInput): OperationPolicy => {
  requireOperator(actorRole);

  if (
    expectedGeneration !== undefined &&
    current.generation !== expectedGeneration
  ) {
    throw new Error("RecoveryGenerationMismatch");
  }

  if (current.state === "disabled" && requestedState !== "disabled") {
    if (actorRole !== "owner") throw new Error("OperatorForbidden");
  }

  return {
    subsystem: current.subsystem,
    state: requestedState,
    generation: current.generation + 1,
    ownerUserId,
    reason,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
};

export const evaluateOperationPolicy = ({
  state,
  generation,
  expectedGeneration,
}: {
  readonly subsystem: OperationSubsystem;
  readonly state: OperationPolicyState;
  readonly generation: number;
  readonly expectedGeneration?: number;
  readonly now: number;
}): OperationPolicyDecision => {
  if (expectedGeneration !== undefined && generation !== expectedGeneration) {
    return { ok: false, errorTag: "RecoveryGenerationMismatch" };
  }

  if (state === "disabled") return { ok: false, errorTag: "SubsystemDisabled" };

  return { ok: true };
};
