import { Data } from "effect";
import * as Either from "effect/Either";

export class LeaseLost extends Data.TaggedError("LeaseLost")<{
  readonly reason: string;
}> {}
export class RetryableJobFailure extends Data.TaggedError(
  "RetryableJobFailure",
)<{ readonly reason: string }> {}
export class PermanentJobFailure extends Data.TaggedError(
  "PermanentJobFailure",
)<{ readonly reason: string }> {}
export class MaxAttemptsReached extends Data.TaggedError("MaxAttemptsReached")<{
  readonly reason: string;
}> {}
export class StaleGeneration extends Data.TaggedError("StaleGeneration")<{
  readonly generation: string;
}> {}
export class DuplicateEffect extends Data.TaggedError("DuplicateEffect")<{
  readonly effectKey: string;
}> {}

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
    policyGeneration: number;
    routeGeneration: number;
    lifecycleGeneration: number;
    emergencyGeneration: number;
    maxAttempts: number;
    now: number;
  }>,
): SourceJobState => ({
  schemaVersion: 1,
  organizationKey: input.organizationKey,
  unitKey: input.unitKey,
  stage: input.stage,
  executionStatus: "queued",
  effectKey: input.effectKey,
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
});
