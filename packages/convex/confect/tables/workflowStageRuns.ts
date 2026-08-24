import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export const WorkflowStageRunRow = Schema.Struct({
  workflowRunId: Schema.String,
  nodeId: Schema.String,
  kind: Schema.Literals([
    "source",
    "capability",
    "agent",
    "delay",
    "approval",
    "output",
    "subworkflow",
    "event",
  ]),
  label: Schema.String,
  status: Schema.Literals([
    "queued",
    "running",
    "completed",
    "succeeded",
    "failed",
    "canceled",
    "skipped",
  ]),
  attempt: Schema.Number,
  startedAt: Schema.Number,
  completedAt: Schema.NullOr(Schema.Number),
  errorJson: Schema.NullOr(Schema.String),
  outputJson: Schema.NullOr(Schema.String),
  componentWorkflowId: Schema.optional(Schema.String),
  // Current writers validate non-negative integer generations. This table
  // remains wide enough to decode immutable staging pilot rows.
  lifecycleGeneration: Schema.optional(Schema.Number),
  externalEffect: Schema.optional(Schema.Boolean),
  stageKey: Schema.optional(Schema.String),
  attemptNumber: Schema.optional(Schema.Number),
  order: Schema.optional(Schema.Number),
  summary: Schema.optional(Schema.String),
});

export default Table.make(() => WorkflowStageRunRow)
  .index("by_run", ["workflowRunId"])
  .index("by_run_node", ["workflowRunId", "nodeId"])
  .index("by_run_generation_stage", [
    "workflowRunId",
    "lifecycleGeneration",
    "stageKey",
  ])
  .index("by_status", ["status"])
  .index("by_component_workflow_order", ["componentWorkflowId", "order"])
  .index("by_component_workflow_stage_attempt", [
    "componentWorkflowId",
    "stageKey",
    "attemptNumber",
  ]);
