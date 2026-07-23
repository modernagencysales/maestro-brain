import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

// prettier-ignore
const SourceProcessingExecutionStatus = Schema.Literal("queued", "leased", "running", "succeeded", "retry_wait", "dead_letter", "superseded", "revoked", "cancelled");

// prettier-ignore
const SourceProcessingStage = Schema.Literal("assembled", "awaiting_policy", "capture_only", "route_pending", "awaiting_classification", "classifying", "awaiting_classification_review", "routed", "classified_no_route", "mixed_client_no_route", "superseded", "revoked");

const ClassificationMessageRow = Schema.Struct({
  sourceRevisionKey: Schema.String,
  authorLabel: Schema.String,
  providerTimestamp: Schema.String,
  canonicalText: Schema.String,
});

const ClassificationTargetRow = Schema.Struct({
  workspaceId: Schema.String,
  organizationId: Schema.String,
  brainKey: Schema.String,
  displayName: Schema.String,
  routingDescription: Schema.optional(Schema.String),
});

const SourceProcessingJobRow = Schema.Struct({
  organizationId: Schema.String,
  workspaceId: Schema.String,
  jobKey: Schema.String,
  sourceUnitRevisionKey: Schema.String,
  sourceUnitHash: Schema.String,
  executionStatus: SourceProcessingExecutionStatus,
  stage: SourceProcessingStage,
  policyVersion: Schema.Number,
  lifecycleGeneration: Schema.Number,
  routeGeneration: Schema.Number,
  leaseGeneration: Schema.Number,
  leaseKey: Schema.optional(Schema.NullOr(Schema.String)),
  leaseExpiresAt: Schema.optional(Schema.NullOr(Schema.Number)),
  nextRetryAt: Schema.optional(Schema.NullOr(Schema.Number)),
  effectKey: Schema.optional(Schema.NullOr(Schema.String)),
  routeEffectKey: Schema.optional(Schema.NullOr(Schema.String)),
  classificationDecisionKey: Schema.optional(Schema.NullOr(Schema.String)),
  classificationPolicyMode: Schema.optional(
    Schema.Literal("direct", "classify", "capture_only"),
  ),
  messages: Schema.optional(Schema.Array(ClassificationMessageRow)),
  allowedTargets: Schema.optional(Schema.Array(ClassificationTargetRow)),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

export default Table.make(() => SourceProcessingJobRow)
  .index("by_stage_status_next_retry", [
    "stage",
    "executionStatus",
    "nextRetryAt",
  ])
  .index("by_effect_key", ["effectKey"])
  .index("by_unit_stage", ["sourceUnitRevisionKey", "stage"])
  .index("by_lease_expiry", ["leaseExpiresAt"])
  .index("by_organization_status", ["organizationId", "executionStatus"]);
