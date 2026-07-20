import {
  OperatorForbidden,
  RecoveryGenerationMismatch,
  SubsystemDisabled,
} from "./brainOperations.spec";

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
  readonly idempotencyKey?: string;
  readonly expiresAt?: number;
};

export type OperationPolicyRecord = {
  readonly policyKey: string;
  readonly kind: "agent.config";
  readonly scope: "workspace";
  readonly workspaceId: string;
  readonly version: number;
  readonly status: "active";
  readonly dataJson: string;
  readonly evalRequired: false;
  readonly activatedByUserId?: string;
  readonly activationReason?: string;
  readonly createdAt: number;
  readonly activatedAt: number;
  readonly retiredAt: null;
};

export type OperationPolicyInput = {
  readonly current: OperationPolicy;
  readonly requestedState: OperationPolicyState;
  readonly actorRole: OperatorRole;
  readonly reason: string;
  readonly ownerUserId: string;
  readonly idempotencyKey: string;
  readonly expectedGeneration?: number;
  readonly expiresAt?: number;
  readonly now: number;
};

export type OperationPolicyError =
  OperatorForbidden | RecoveryGenerationMismatch | SubsystemDisabled;

const redactedOperatorReason = "operator reason redacted";

export const redactOperationPolicyReason = (): string => redactedOperatorReason;

export type OperationPolicyDecision =
  | { readonly ok: true }
  | {
      readonly ok: false;
      readonly error: RecoveryGenerationMismatch | SubsystemDisabled;
      readonly errorTag: "SubsystemDisabled" | "RecoveryGenerationMismatch";
    };

const operatorRank: Record<OperatorRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
  owner: 3,
};

const requireOperator = (role: OperatorRole): OperatorForbidden | null =>
  operatorRank[role] < operatorRank.admin
    ? new OperatorForbidden({ reason: "admin role required" })
    : null;

export const nextOperationPolicy = ({
  current,
  requestedState,
  actorRole,
  ownerUserId,
  expectedGeneration,
  expiresAt,
  idempotencyKey,
}: OperationPolicyInput):
  OperationPolicy | OperatorForbidden | RecoveryGenerationMismatch => {
  const operatorError = requireOperator(actorRole);
  if (operatorError !== null) return operatorError;

  if (
    expectedGeneration !== undefined &&
    current.generation !== expectedGeneration
  ) {
    return new RecoveryGenerationMismatch({
      expectedGeneration,
      actualGeneration: current.generation,
    });
  }

  if (current.state === "disabled" && requestedState !== "disabled") {
    if (actorRole !== "owner") {
      return new OperatorForbidden({ reason: "owner role required" });
    }
  }

  return {
    subsystem: current.subsystem,
    state: requestedState,
    generation: current.generation + 1,
    ownerUserId,
    reason: redactOperationPolicyReason(),
    idempotencyKey,
    ...(expiresAt === undefined ? {} : { expiresAt }),
  };
};

export const evaluateOperationPolicy = ({
  subsystem,
  state,
  generation,
  expectedGeneration,
  expiresAt,
  now,
}: {
  readonly subsystem: OperationSubsystem;
  readonly state: OperationPolicyState;
  readonly generation: number;
  readonly expectedGeneration?: number;
  readonly expiresAt?: number;
  readonly now: number;
}): OperationPolicyDecision => {
  if (expiresAt !== undefined && expiresAt <= now) return { ok: true };

  if (expectedGeneration !== undefined && generation !== expectedGeneration) {
    return {
      ok: false,
      error: new RecoveryGenerationMismatch({
        expectedGeneration,
        actualGeneration: generation,
      }),
      errorTag: "RecoveryGenerationMismatch",
    };
  }

  if (state === "disabled") {
    return {
      ok: false,
      error: new SubsystemDisabled({ subsystem }),
      errorTag: "SubsystemDisabled",
    };
  }

  return { ok: true };
};

export const replayOperationPolicyByIdempotencyKey = (
  policies: readonly OperationPolicy[],
  idempotencyKey: string,
): OperationPolicy | undefined =>
  policies.find((policy) => policy.idempotencyKey === idempotencyKey);

export const operationPolicyKey = (
  workspaceId: string,
  subsystem: OperationSubsystem,
): string => `brainOperation:${workspaceId}:${subsystem}`;

export const defaultOperationPolicy = (
  subsystem: OperationSubsystem,
): OperationPolicy => ({
  subsystem,
  state: "enabled",
  generation: 1,
  ownerUserId: "users_system",
  reason: "Default operations policy is enabled.",
});

export const operationPolicyRecord = (input: {
  readonly workspaceId: string;
  readonly policy: OperationPolicy;
  readonly updatedAt: number;
}): OperationPolicyRecord => ({
  policyKey: operationPolicyKey(input.workspaceId, input.policy.subsystem),
  kind: "agent.config",
  scope: "workspace",
  workspaceId: input.workspaceId,
  version: input.policy.generation,
  status: "active",
  dataJson: JSON.stringify({
    ...input.policy,
    reason:
      input.policy.reason === undefined
        ? undefined
        : redactOperationPolicyReason(),
  }),
  evalRequired: false,
  ...(input.policy.ownerUserId === undefined
    ? {}
    : { activatedByUserId: input.policy.ownerUserId }),
  ...(input.policy.reason === undefined
    ? {}
    : { activationReason: "operation policy changed" }),
  createdAt: input.updatedAt,
  activatedAt: input.updatedAt,
  retiredAt: null,
});

export const operationPolicyFromRecord = (record: {
  readonly dataJson: string;
}): OperationPolicy => JSON.parse(record.dataJson) as OperationPolicy;

export const isOperationPolicyError = (
  value: OperationPolicy | OperationPolicyError,
): value is OperationPolicyError => value instanceof Error;

export const operationPolicyAuditEvent = (input: {
  readonly workspaceId: string;
  readonly actorUserId?: string;
  readonly policy: OperationPolicy;
  readonly previousGeneration: number;
  readonly updatedAt: number;
}) => ({
  workspaceId: input.workspaceId,
  action: "model.egressPolicyChanged" as const,
  ...(input.actorUserId === undefined
    ? {}
    : { actorUserId: input.actorUserId }),
  subjectKind: "privilegedAction" as const,
  subjectId: input.policy.subsystem,
  metadata: {
    outcome: "changed",
    subsystem: input.policy.subsystem,
    state: input.policy.state,
    generation: input.policy.generation,
    previousGeneration: input.previousGeneration,
    ...(input.policy.expiresAt === undefined
      ? {}
      : { expiresAt: input.policy.expiresAt }),
  },
});
