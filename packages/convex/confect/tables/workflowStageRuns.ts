import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export const WorkflowStageRunRow = Schema.Struct({
  workflowRunId: Schema.String,
  nodeId: Schema.String,
  kind: Schema.Literal(
    "source",
    "capability",
    "agent",
    "delay",
    "approval",
    "output",
  ),
  label: Schema.String,
  status: Schema.Literal(
    "queued",
    "running",
    "completed",
    "succeeded",
    "failed",
    "canceled",
    "skipped",
  ),
  attempt: Schema.Number,
  startedAt: Schema.Number,
  completedAt: Schema.NullOr(Schema.Number),
  errorJson: Schema.NullOr(Schema.String),
  outputJson: Schema.NullOr(Schema.String),
  componentWorkflowId: Schema.optional(Schema.String),
  stageKey: Schema.optional(Schema.String),
  attemptNumber: Schema.optional(Schema.Number),
  order: Schema.optional(Schema.Number),
  summary: Schema.optional(Schema.String),
  // Immutable execution fences written by the staging workflow pilot.
  externalEffect: Schema.optional(Schema.Boolean),
  lifecycleGeneration: Schema.optional(Schema.Number),
});

export default Table.make(() => WorkflowStageRunRow)
  .index("by_run", ["workflowRunId"])
  .index("by_run_node", ["workflowRunId", "nodeId"])
  .index("by_status", ["status"])
  .index("by_component_workflow_order", ["componentWorkflowId", "order"])
  .index("by_component_workflow_stage_attempt", [
    "componentWorkflowId",
    "stageKey",
    "attemptNumber",
  ]);
