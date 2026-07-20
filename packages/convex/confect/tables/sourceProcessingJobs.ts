import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export const SourceProcessingExecutionStatus = Schema.Literal(
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

export const SourceProcessingStage = Schema.Literal(
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

export const SourceProcessingJobRow = Schema.Struct({
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
  routeEffectKey: Schema.optional(Schema.NullOr(Schema.String)),
  classificationDecisionKey: Schema.optional(Schema.NullOr(Schema.String)),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

export default Table.make(() => SourceProcessingJobRow)
  .index("by_workspace_stage", ["workspaceId", "stage"])
  .index("by_source_unit", ["sourceUnitRevisionKey"])
  .index("by_job_key", ["jobKey"])
  .index("by_workspace_execution", ["workspaceId", "executionStatus"])
  .index("by_classification_decision", ["classificationDecisionKey"]);
