import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export const SourceProcessingMaintenanceState = Schema.Struct({
  maintenanceStatus: Schema.Literal(
    "not_required",
    "queued",
    "proposal_pending",
    "proposal_published",
    "proposal_rejected",
    "fenced",
  ),
  maintenanceProposalKey: Schema.optional(Schema.String),
  maintenanceWorkflowId: Schema.optional(Schema.String),
  maintenanceUpdatedAt: Schema.Number,
});

export default Table.make(() =>
  Schema.Struct({
    workspaceId: Schema.String,
    sourceProcessingJobKey: Schema.String,
    sourceUnitKey: Schema.String,
    routeGeneration: Schema.Number,
    lifecycleGeneration: Schema.Number,
    status: Schema.Literal(
      "queued",
      "running",
      "completed",
      "failed",
      "canceled",
    ),
    maintenance: SourceProcessingMaintenanceState,
    createdAt: Schema.Number,
    updatedAt: Schema.Number,
  }),
)
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_job", ["workspaceId", "sourceProcessingJobKey"])
  .index("by_workspace_maintenance", [
    "workspaceId",
    "maintenance.maintenanceStatus",
  ]);
