import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

const SourceJobStage = Schema.Literal(
  "assembled",
  "awaiting_policy",
  "capture_only",
  "route_pending",
  "awaiting_classification",
  "classifying",
  "awaiting_classification_review",
  "routed",
  "classified_no_route",
  "mixed_client_no_route",
  "superseded",
  "revoked",
);

const SourceJobExecutionStatus = Schema.Literal(
  "queued",
  "leased",
  "running",
  "succeeded",
  "retry_wait",
  "dead_letter",
  "superseded",
  "revoked",
  "cancelled",
);

const SourceJobAttemptReceipt = Schema.Struct({
  attempt: Schema.Number,
  leaseGeneration: Schema.Number,
  leaseTokenHash: Schema.String,
  owner: Schema.String,
  startedAt: Schema.Number,
  completedAt: Schema.optional(Schema.Number),
  externalResponseHash: Schema.optional(Schema.String),
  acceptedEffectKey: Schema.optional(Schema.String),
  errorTag: Schema.optional(
    Schema.Literal(
      "RetryableJobFailure",
      "PermanentJobFailure",
      "MaxAttemptsReached",
    ),
  ),
  errorReason: Schema.optional(Schema.String),
});

export const SourceProcessingJobRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  unitKey: Schema.String,
  stage: SourceJobStage,
  executionStatus: SourceJobExecutionStatus,
  effectKey: Schema.String,
  acceptedEffectKey: Schema.optional(Schema.String),
  policyGeneration: Schema.Number,
  routeGeneration: Schema.Number,
  lifecycleGeneration: Schema.Number,
  emergencyGeneration: Schema.Number,
  leaseGeneration: Schema.Number,
  leaseToken: Schema.optional(Schema.String),
  leaseOwner: Schema.optional(Schema.String),
  leaseExpiresAt: Schema.optional(Schema.Number),
  attempt: Schema.Number,
  maxAttempts: Schema.Number,
  nextRetryAt: Schema.Number,
  externalResponseHash: Schema.optional(Schema.String),
  attemptReceipts: Schema.Array(SourceJobAttemptReceipt),
  lastError: Schema.optional(
    Schema.Struct({
      tag: Schema.Literal(
        "RetryableJobFailure",
        "PermanentJobFailure",
        "MaxAttemptsReached",
      ),
      reason: Schema.String,
    }),
  ),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

export type SourceProcessingJobRowValue = typeof SourceProcessingJobRow.Type;

export default Table.make(() => SourceProcessingJobRow)
  .index("by_stage_status_next_retry", [
    "stage",
    "executionStatus",
    "nextRetryAt",
  ])
  .index("by_effect_key", ["effectKey"])
  .index("by_unit_stage", ["unitKey", "stage"])
  .index("by_lease_expiry", ["leaseExpiresAt"])
  .index("by_organization_status", ["organizationKey", "executionStatus"]);
