import * as Either from "effect/Either";
import * as Schema from "effect/Schema";

export class LeaseLost extends Schema.TaggedError<LeaseLost>()("LeaseLost", {
  reason: Schema.String,
}) {}
export class RetryableJobFailure extends Schema.TaggedError<RetryableJobFailure>()(
  "RetryableJobFailure",
  {
    reason: Schema.String,
  },
) {}
export class PermanentJobFailure extends Schema.TaggedError<PermanentJobFailure>()(
  "PermanentJobFailure",
  {
    reason: Schema.String,
  },
) {}
export class MaxAttemptsReached extends Schema.TaggedError<MaxAttemptsReached>()(
  "MaxAttemptsReached",
  {
    reason: Schema.String,
  },
) {}
export class StaleGeneration extends Schema.TaggedError<StaleGeneration>()(
  "StaleGeneration",
  {
    generation: Schema.String,
  },
) {}
export class DuplicateEffect extends Schema.TaggedError<DuplicateEffect>()(
  "DuplicateEffect",
  {
    effectKey: Schema.String,
  },
) {}

export const SourceWorkpoolError = Schema.Union(
  LeaseLost,
  RetryableJobFailure,
  PermanentJobFailure,
  MaxAttemptsReached,
  StaleGeneration,
  DuplicateEffect,
);

export type SourceJobStage =
  | "assembled"
  | "awaiting_policy"
  | "capture_only"
  | "route_pending"
  | "awaiting_classification"
  | "classifying"
  | "awaiting_classification_review"
  | "routed"
  | "classified_no_route"
  | "mixed_client_no_route"
  | "superseded"
  | "revoked";
export type SourceJobExecutionStatus =
  | "queued"
  | "leased"
  | "running"
  | "succeeded"
  | "retry_wait"
  | "dead_letter"
  | "superseded"
  | "revoked"
  | "cancelled";
export type SourceJobErrorTag =
  "RetryableJobFailure" | "PermanentJobFailure" | "MaxAttemptsReached";
export type SourceJobAttemptReceipt = Readonly<{
  attempt: number;
  leaseGeneration: number;
  leaseTokenHash: string;
  owner: string;
  startedAt: number;
  completedAt?: number;
  externalResponseHash?: string;
  acceptedEffectKey?: string;
  errorTag?: SourceJobErrorTag;
  errorReason?: string;
}>;
export type SourceJobState = Readonly<{
  schemaVersion: 1;
  organizationKey: string;
  unitKey: string;
  stage: SourceJobStage;
  executionStatus: SourceJobExecutionStatus;
  effectKey: string;
  idempotencyKey?: string;
  organizationUnitIdempotencyKey?: string;
  workId?: string;
  acceptedEffectKey?: string;
  policyGeneration: number;
  routeGeneration: number;
  lifecycleGeneration: number;
  emergencyGeneration: number;
  leaseGeneration: number;
  leaseToken?: string | undefined;
  leaseOwner?: string | undefined;
  leaseExpiresAt?: number | undefined;
  attempt: number;
  maxAttempts: number;
  nextRetryAt: number;
  externalResponseHash?: string;
  attemptReceipts: readonly SourceJobAttemptReceipt[];
  lastError?: Readonly<{ tag: SourceJobErrorTag; reason: string }>;
  createdAt: number;
  updatedAt: number;
}>;

export const createSourceJobState = (
  input: Readonly<{
    organizationKey: string;
    unitKey: string;
    stage: SourceJobStage;
    effectKey: string;
    idempotencyKey?: string;
    organizationUnitIdempotencyKey?: string;
    workId?: string;
    policyGeneration: number;
    routeGeneration: number;
    lifecycleGeneration: number;
    emergencyGeneration: number;
    maxAttempts: number;
    now: number;
  }>,
): SourceJobState => {
  const optionalFields: {
    idempotencyKey?: string;
    organizationUnitIdempotencyKey?: string;
    workId?: string;
  } = {};
  if (input.idempotencyKey !== undefined)
    optionalFields.idempotencyKey = input.idempotencyKey;
  if (input.organizationUnitIdempotencyKey !== undefined)
    optionalFields.organizationUnitIdempotencyKey =
      input.organizationUnitIdempotencyKey;
  if (input.workId !== undefined) optionalFields.workId = input.workId;
  return {
    schemaVersion: 1,
    organizationKey: input.organizationKey,
    unitKey: input.unitKey,
    stage: input.stage,
    executionStatus: "queued",
    effectKey: input.effectKey,
    ...optionalFields,
    policyGeneration: input.policyGeneration,
    routeGeneration: input.routeGeneration,
    lifecycleGeneration: input.lifecycleGeneration,
    emergencyGeneration: input.emergencyGeneration,
    leaseGeneration: 0,
    attempt: 0,
    maxAttempts: input.maxAttempts,
    nextRetryAt: input.now,
    attemptReceipts: [],
    createdAt: input.now,
    updatedAt: input.now,
  };
};

type LeaseInput = Readonly<{ leaseGeneration: number; leaseToken: string }>;
type SourceJobResult<E> = Either.Either<SourceJobState, E>;
type GenerationInput = Readonly<{
  policyGeneration: number;
  routeGeneration: number;
  lifecycleGeneration: number;
  emergencyGeneration: number;
}>;

export const tokenHash = (leaseToken: string): string =>
  `lease-token:${leaseToken.length}:${leaseToken.slice(0, 4)}`;
export const assertCurrentLease = (
  job: SourceJobState,
  input: LeaseInput,
): Either.Either<void, LeaseLost> =>
  job.leaseGeneration !== input.leaseGeneration ||
  job.leaseToken !== input.leaseToken ||
  job.executionStatus === "queued"
    ? Either.left(new LeaseLost({ reason: "lease token is no longer current" }))
    : Either.right(undefined);

export const startSourceJob = (
  job: SourceJobState,
  input: Readonly<{
    owner: string;
    leaseToken: string;
    leaseDurationMs: number;
    now: number;
  }>,
): SourceJobResult<DuplicateEffect> => {
  if (job.acceptedEffectKey === job.effectKey)
    return Either.left(new DuplicateEffect({ effectKey: job.effectKey }));
  const leaseGeneration = job.leaseGeneration + 1;
  const attempt = job.attempt + 1;
  return Either.right({
    ...job,
    executionStatus: "leased",
    leaseGeneration,
    leaseToken: input.leaseToken,
    leaseOwner: input.owner,
    leaseExpiresAt: input.now + input.leaseDurationMs,
    attempt,
    attemptReceipts: [
      ...job.attemptReceipts,
      {
        attempt,
        leaseGeneration,
        leaseTokenHash: tokenHash(input.leaseToken),
        owner: input.owner,
        startedAt: input.now,
      },
    ],
    updatedAt: input.now,
  });
};

export const markSourceJobRunning = (
  job: SourceJobState,
  input: LeaseInput & { now: number },
): SourceJobResult<LeaseLost> => {
  const lease = assertCurrentLease(job, input);
  if (Either.isLeft(lease)) return Either.left(lease.left);
  return Either.right({
    ...job,
    executionStatus: "running",
    updatedAt: input.now,
  });
};
export const recordExternalResponse = (
  job: SourceJobState,
  input: LeaseInput & {
    responseHash: string;
    now: number;
  },
): SourceJobResult<LeaseLost> => {
  const lease = assertCurrentLease(job, input);
  if (Either.isLeft(lease)) return Either.left(lease.left);
  return Either.right({
    ...job,
    externalResponseHash: input.responseHash,
    attemptReceipts: updateCurrentReceipt(job, {
      externalResponseHash: input.responseHash,
    }),
    updatedAt: input.now,
  });
};

export const succeedSourceJob = (
  job: SourceJobState,
  input: LeaseInput &
    GenerationInput & {
      effectKey: string;
      now: number;
    },
): SourceJobResult<LeaseLost | StaleGeneration | DuplicateEffect> => {
  const lease = assertCurrentLease(job, input);
  if (Either.isLeft(lease)) return Either.left(lease.left);
  const generation = assertPinnedGenerations(job, input);
  if (Either.isLeft(generation)) return Either.left(generation.left);
  if (
    job.acceptedEffectKey === input.effectKey ||
    job.effectKey !== input.effectKey
  ) {
    return Either.left(new DuplicateEffect({ effectKey: input.effectKey }));
  }
  return Either.right({
    ...job,
    executionStatus: "succeeded",
    acceptedEffectKey: input.effectKey,
    attemptReceipts: updateCurrentReceipt(job, {
      acceptedEffectKey: input.effectKey,
      completedAt: input.now,
    }),
    updatedAt: input.now,
  });
};

export const scheduleRetry = (
  job: SourceJobState,
  input: LeaseInput & {
    reason: string;
    retryAfterMs: number;
    now: number;
  },
): SourceJobResult<LeaseLost> => {
  const lease = assertCurrentLease(job, input);
  if (Either.isLeft(lease)) return Either.left(lease.left);
  if (job.attempt >= job.maxAttempts)
    return Either.right(
      deadLetter(job, "MaxAttemptsReached", input.reason, input.now),
    );
  return Either.right({
    ...job,
    executionStatus: "retry_wait",
    leaseToken: undefined,
    leaseOwner: undefined,
    leaseExpiresAt: undefined,
    nextRetryAt: input.now + input.retryAfterMs,
    lastError: { tag: "RetryableJobFailure", reason: input.reason },
    attemptReceipts: updateCurrentReceipt(job, {
      completedAt: input.now,
      errorTag: "RetryableJobFailure",
      errorReason: input.reason,
    }),
    updatedAt: input.now,
  });
};

export const failSourceJob = (
  job: SourceJobState,
  input:
    | (LeaseInput & {
        kind: "retryable" | "permanent";
        reason: string;
        now: number;
      })
    | { kind: "cancelled" | "revoked" | "superseded"; now: number },
): SourceJobResult<LeaseLost> => {
  if (!("leaseToken" in input))
    return Either.right({
      ...job,
      executionStatus: input.kind,
      updatedAt: input.now,
    });
  const lease = assertCurrentLease(job, input);
  if (Either.isLeft(lease)) return Either.left(lease.left);
  return Either.right(
    deadLetter(
      job,
      input.kind === "retryable" ? "MaxAttemptsReached" : "PermanentJobFailure",
      input.reason,
      input.now,
    ),
  );
};

const deadLetter = (
  job: SourceJobState,
  tag: SourceJobErrorTag,
  reason: string,
  now: number,
): SourceJobState => ({
  ...job,
  executionStatus: "dead_letter",
  leaseToken: undefined,
  leaseOwner: undefined,
  leaseExpiresAt: undefined,
  lastError: { tag, reason },
  attemptReceipts: updateCurrentReceipt(job, {
    completedAt: now,
    errorTag: tag,
    errorReason: reason,
  }),
  updatedAt: now,
});
const assertPinnedGenerations = (
  job: SourceJobState,
  input: GenerationInput,
): Either.Either<void, StaleGeneration> => {
  const staleGeneration =
    job.policyGeneration !== input.policyGeneration
      ? "policyGeneration"
      : job.routeGeneration !== input.routeGeneration
        ? "routeGeneration"
        : job.lifecycleGeneration !== input.lifecycleGeneration
          ? "lifecycleGeneration"
          : job.emergencyGeneration !== input.emergencyGeneration
            ? "emergencyGeneration"
            : undefined;
  return staleGeneration
    ? Either.left(new StaleGeneration({ generation: staleGeneration }))
    : Either.right(undefined);
};
const updateCurrentReceipt = (
  job: SourceJobState,
  update: Partial<SourceJobAttemptReceipt>,
): readonly SourceJobAttemptReceipt[] =>
  job.attemptReceipts.map((receipt) =>
    receipt.attempt === job.attempt &&
    receipt.leaseGeneration === job.leaseGeneration
      ? { ...receipt, ...update }
      : receipt,
  );
