import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

// prettier-ignore
const SourceProcessingExecutionStatus = Schema.Literal("queued", "leased", "running", "succeeded", "retry_wait", "dead_letter", "superseded", "revoked", "cancelled");

// prettier-ignore
const SourceProcessingStage = Schema.Literal("assembled", "awaiting_policy", "capture_only", "route_pending", "awaiting_classification", "classifying", "awaiting_classification_review", "routed", "classified_no_route", "mixed_client_no_route", "superseded", "revoked");

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
