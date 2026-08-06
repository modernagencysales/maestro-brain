import * as Either from "effect/Either";

import type { OperationPolicy } from "../ops/brainOperationPolicy";
import type { ChannelDeliveryPolicyRowValue } from "../tables/channelDeliveryPolicies";
import type { SlackIdentityBindingRowValue } from "../tables/slackIdentityBindings";
import { sha256Hex } from "../shared/sha256";

export type AnswerPayload = Readonly<{
  readonly format: "mrkdwn";
  readonly text: string;
  readonly citations: readonly Readonly<{
    readonly sourceKey: string;
    readonly label: string;
  }>[];
}>;

export type AnswerDeliveryInput = Readonly<{
  readonly organizationKey: string;
  readonly workspaceId: string;
  readonly brainKey: string;
  readonly requestId: string;
  readonly answerReference: string;
  readonly answerPayload: AnswerPayload;
  readonly requesterUserId: string;
  readonly requesterSlackUserId: string;
  readonly bindingKey: string;
  readonly bindingGeneration: number;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly teamId: string;
  readonly channelKey: string;
  readonly externalChannelId: string;
  readonly deliveryGeneration: number;
  readonly operationGeneration: number;
  readonly now: number;
}>;

type AnswerBinding = Pick<
  SlackIdentityBindingRowValue,
  | "organizationKey"
  | "connectionKey"
  | "connectionGeneration"
  | "teamId"
  | "workspaceId"
  | "brainKey"
  | "slackUserId"
  | "userId"
  | "bindingKey"
  | "bindingGeneration"
  | "status"
>;

type AnswerPolicy = Pick<
  ChannelDeliveryPolicyRowValue,
  "organizationKey" | "channelKey" | "deliveryGeneration" | "active" | "mode"
>;

type AnswerOperation = Pick<
  OperationPolicy,
  "subsystem" | "state" | "generation"
>;

export type AnswerDeliveryAuthorization = Readonly<{
  readonly lifecycle: AnswerLifecycleFence;
}>;

export type AnswerDeliveryAuthorizationError = Readonly<{
  readonly _tag: "AnswerDeliveryAuthorizationError";
  readonly reason:
    | "binding_not_active"
    | "tenant_mismatch"
    | "requester_mismatch"
    | "connection_generation_mismatch"
    | "binding_generation_mismatch"
    | "policy_not_private"
    | "policy_generation_mismatch"
    | "operation_not_enabled"
    | "operation_generation_mismatch";
}>;

export type AnswerLifecycleFence = Readonly<{
  readonly organizationKey: string;
  readonly workspaceId: string;
  readonly brainKey: string;
  readonly bindingKey: string;
  readonly bindingGeneration: number;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly teamId: string;
  readonly channelKey: string;
  readonly deliveryGeneration: number;
  readonly operationGeneration: number;
}>;

export type AnswerOutboxStatus =
  "pending" | "in_flight" | "retryable" | "sent" | "failed" | "expired";

export type SlackAnswerOutboxRow = Readonly<{
  readonly answerKey: string;
  readonly answerReference: string;
  readonly answer: AnswerPayload;
  readonly requester: Readonly<{
    readonly userId: string;
    readonly slackUserId: string;
  }>;
  readonly delivery: Readonly<{
    readonly organizationKey: string;
    readonly workspaceId: string;
    readonly brainKey: string;
    readonly connectionKey: string;
    readonly teamId: string;
    readonly channelKey: string;
    readonly externalChannelId: string;
  }>;
  readonly lifecycle: AnswerLifecycleFence;
  readonly status: AnswerOutboxStatus;
  readonly attempt: number;
  readonly leaseToken?: string;
  readonly leaseExpiresAt?: number;
  readonly lastError?: Readonly<{
    readonly kind: "retryable" | "terminal";
    readonly code: string;
  }>;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly sentAt?: number;
}>;

const withoutLease = (row: SlackAnswerOutboxRow) => {
  const copy = { ...row };
  delete copy.leaseToken;
  delete copy.leaseExpiresAt;
  return copy;
};

export type AnswerOutboxError = Readonly<{
  readonly _tag: "AnswerOutboxError";
  readonly reason:
    | "lifecycle_fence"
    | "lease_mismatch"
    | "lease_not_expired"
    | "invalid_state"
    | "terminal_state";
}>;

const authorizationError = (
  reason: AnswerDeliveryAuthorizationError["reason"],
): AnswerDeliveryAuthorizationError => ({
  _tag: "AnswerDeliveryAuthorizationError",
  reason,
});

const outboxError = (
  reason: AnswerOutboxError["reason"],
): AnswerOutboxError => ({
  _tag: "AnswerOutboxError",
  reason,
});

export const answerKeyFor = (
  input: Pick<
    AnswerDeliveryInput,
    "organizationKey" | "requesterUserId" | "requestId" | "answerReference"
  >,
): string =>
  `slack-answer:${sha256Hex(
    JSON.stringify([
      input.organizationKey,
      input.requesterUserId,
      input.requestId,
      input.answerReference,
    ]),
  )}`;

export const authorizeAnswerDelivery = (input: {
  readonly input: AnswerDeliveryInput;
  readonly binding: AnswerBinding;
  readonly policy: AnswerPolicy;
  readonly operation: AnswerOperation;
}): Either.Either<
  AnswerDeliveryAuthorization,
  AnswerDeliveryAuthorizationError
> => {
  const { input: request, binding, policy, operation } = input;
  if (binding.status !== "active")
    return Either.left(authorizationError("binding_not_active"));
  if (
    binding.organizationKey !== request.organizationKey ||
    binding.workspaceId !== request.workspaceId ||
    binding.brainKey !== request.brainKey ||
    binding.bindingKey !== request.bindingKey
  )
    return Either.left(authorizationError("tenant_mismatch"));
  if (
    binding.userId !== request.requesterUserId ||
    binding.slackUserId !== request.requesterSlackUserId
  )
    return Either.left(authorizationError("requester_mismatch"));
  if (
    binding.connectionKey !== request.connectionKey ||
    binding.connectionGeneration !== request.connectionGeneration ||
    binding.teamId !== request.teamId
  )
    return Either.left(authorizationError("connection_generation_mismatch"));
  if (binding.bindingGeneration !== request.bindingGeneration)
    return Either.left(authorizationError("binding_generation_mismatch"));
  if (
    policy.organizationKey !== request.organizationKey ||
    policy.channelKey !== request.channelKey ||
    !policy.active ||
    policy.mode !== "requester_private"
  )
    return Either.left(authorizationError("policy_not_private"));
  if (policy.deliveryGeneration !== request.deliveryGeneration)
    return Either.left(authorizationError("policy_generation_mismatch"));
  if (operation.subsystem !== "slackDelivery" || operation.state !== "enabled")
    return Either.left(authorizationError("operation_not_enabled"));
  if (operation.generation !== request.operationGeneration)
    return Either.left(authorizationError("operation_generation_mismatch"));
  return Either.right({
    lifecycle: {
      organizationKey: request.organizationKey,
      workspaceId: request.workspaceId,
      brainKey: request.brainKey,
      bindingKey: request.bindingKey,
      bindingGeneration: request.bindingGeneration,
      connectionKey: request.connectionKey,
      connectionGeneration: request.connectionGeneration,
      teamId: request.teamId,
      channelKey: request.channelKey,
      deliveryGeneration: request.deliveryGeneration,
      operationGeneration: request.operationGeneration,
    },
  });
};

export const answerOutboxRow = (input: {
  readonly input: AnswerDeliveryInput;
  readonly authorized: AnswerDeliveryAuthorization;
}): SlackAnswerOutboxRow => ({
  answerKey: answerKeyFor(input.input),
  answerReference: input.input.answerReference,
  answer: input.input.answerPayload,
  requester: {
    userId: input.input.requesterUserId,
    slackUserId: input.input.requesterSlackUserId,
  },
  delivery: {
    organizationKey: input.input.organizationKey,
    workspaceId: input.input.workspaceId,
    brainKey: input.input.brainKey,
    connectionKey: input.input.connectionKey,
    teamId: input.input.teamId,
    channelKey: input.input.channelKey,
    externalChannelId: input.input.externalChannelId,
  },
  lifecycle: input.authorized.lifecycle,
  status: "pending",
  attempt: 0,
  createdAt: input.input.now,
  updatedAt: input.input.now,
});

const lifecycleMatches = (
  actual: AnswerLifecycleFence,
  expected: AnswerLifecycleFence,
) => JSON.stringify(actual) === JSON.stringify(expected);

const fenced = (
  row: SlackAnswerOutboxRow,
  expectedLifecycle: AnswerLifecycleFence,
): AnswerOutboxError | null =>
  lifecycleMatches(row.lifecycle, expectedLifecycle)
    ? null
    : outboxError("lifecycle_fence");

export const claimAnswerOutboxRow = (
  row: SlackAnswerOutboxRow,
  input: Readonly<{
    readonly expectedLifecycle: AnswerLifecycleFence;
    readonly leaseToken: string;
    readonly leaseExpiresAt: number;
    readonly now: number;
  }>,
): Either.Either<SlackAnswerOutboxRow, AnswerOutboxError> => {
  const fence = fenced(row, input.expectedLifecycle);
  if (fence !== null) return Either.left(fence);
  if (row.status !== "pending" && row.status !== "retryable")
    return Either.left(outboxError("invalid_state"));
  return Either.right({
    ...row,
    status: "in_flight",
    attempt: row.attempt + 1,
    leaseToken: input.leaseToken,
    leaseExpiresAt: input.leaseExpiresAt,
    updatedAt: input.now,
  });
};

export const recordAnswerDeliveryFailure = (
  row: SlackAnswerOutboxRow,
  input: Readonly<{
    readonly expectedLifecycle: AnswerLifecycleFence;
    readonly leaseToken: string;
    readonly kind: "retryable" | "terminal";
    readonly code: string;
    readonly now: number;
  }>,
): Either.Either<SlackAnswerOutboxRow, AnswerOutboxError> => {
  const fence = fenced(row, input.expectedLifecycle);
  if (fence !== null) return Either.left(fence);
  if (
    row.status === "failed" ||
    row.status === "sent" ||
    row.status === "expired"
  )
    return Either.left(outboxError("terminal_state"));
  if (row.status !== "in_flight" || row.leaseToken !== input.leaseToken)
    return Either.left(outboxError("lease_mismatch"));
  return Either.right({
    ...withoutLease(row),
    status: input.kind === "retryable" ? "retryable" : "failed",
    lastError: { kind: input.kind, code: input.code },
    updatedAt: input.now,
  });
};

export const completeAnswerDelivery = (
  row: SlackAnswerOutboxRow,
  input: Readonly<{
    readonly expectedLifecycle: AnswerLifecycleFence;
    readonly leaseToken: string;
    readonly now: number;
  }>,
): Either.Either<SlackAnswerOutboxRow, AnswerOutboxError> => {
  const fence = fenced(row, input.expectedLifecycle);
  if (fence !== null) return Either.left(fence);
  if (row.status === "failed" || row.status === "expired")
    return Either.left(outboxError("terminal_state"));
  if (row.status !== "in_flight" || row.leaseToken !== input.leaseToken)
    return Either.left(outboxError("lease_mismatch"));
  return Either.right({
    ...withoutLease(row),
    status: "sent",
    sentAt: input.now,
    updatedAt: input.now,
  });
};

export const recoverExpiredAnswerDelivery = (
  row: SlackAnswerOutboxRow,
  input: Readonly<{
    readonly expectedLifecycle: AnswerLifecycleFence;
    readonly now: number;
  }>,
): Either.Either<SlackAnswerOutboxRow, AnswerOutboxError> => {
  const fence = fenced(row, input.expectedLifecycle);
  if (fence !== null) return Either.left(fence);
  if (row.status !== "in_flight")
    return Either.left(outboxError("invalid_state"));
  if ((row.leaseExpiresAt ?? Number.POSITIVE_INFINITY) > input.now)
    return Either.left(outboxError("lease_not_expired"));
  return Either.right({
    ...withoutLease(row),
    status: "retryable",
    updatedAt: input.now,
  });
};
