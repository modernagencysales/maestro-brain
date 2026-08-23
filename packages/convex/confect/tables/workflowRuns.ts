import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export const WorkflowRunStatus = Schema.Literal(
  "queued",
  "running",
  "completed",
  "failed",
  "canceled",
  "timedOut",
);

export type WorkflowRunStatus = Schema.Schema.Type<typeof WorkflowRunStatus>;

const HistoricalOnCompleteContext = Schema.Struct({
  generation: Schema.Number,
  generationAnchor: Schema.String,
  workflowId: Schema.String,
  workflowRunId: Schema.String,
  workflowVersion: Schema.Number,
  workspaceId: Schema.String,
});

const HistoricalPolicySnapshot = Schema.Struct({
  kind: Schema.Literal("none"),
  reason: Schema.String,
  version: Schema.Number,
});

const HistoricalPrincipalSnapshot = Schema.Struct({
  actorId: Schema.String,
  authEpoch: Schema.Number,
  grants: Schema.Array(Schema.String),
  kickoffAt: Schema.Number,
  kind: Schema.Literal("user"),
  provenance: Schema.String,
  role: Schema.Literal("viewer", "editor", "admin", "owner"),
  version: Schema.Number,
  workspaceId: Schema.String,
});

export const WorkflowRunRow = Schema.Struct({
  workspaceId: Schema.String,
  workflowId: Schema.String,
  workflowVersion: Schema.Number,
  graphJson: Schema.String,
  status: WorkflowRunStatus,
  idempotencyKey: Schema.String,
  startedByUserId: Schema.String,
  startedAt: Schema.Number,
  completedAt: Schema.NullOr(Schema.Number),
  failedAt: Schema.NullOr(Schema.Number),
  trustReceiptId: Schema.NullOr(Schema.String),
  componentWorkflowId: Schema.optional(Schema.String),
  workflowKind: Schema.optional(Schema.String),
  sourceRunKind: Schema.optional(Schema.String),
  sourceRunId: Schema.optional(Schema.String),
  timeoutMs: Schema.optional(Schema.Number),
  deadlineAt: Schema.optional(Schema.Number),
  timedOutAt: Schema.optional(Schema.NullOr(Schema.Number)),
  timeoutErrorCode: Schema.optional(Schema.NullOr(Schema.String)),
  timeoutSummary: Schema.optional(Schema.NullOr(Schema.String)),
  // Immutable lifecycle and retention snapshots from the staging workflow pilot.
  childRetentionUntil: Schema.optional(Schema.NullOr(Schema.Number)),
  cleanupState: Schema.optional(Schema.Literal("not-requested")),
  componentCleanupState: Schema.optional(Schema.Literal("not-requested")),
  componentResidualState: Schema.optional(Schema.Literal("not-assessed")),
  evidenceRetentionUntil: Schema.optional(Schema.NullOr(Schema.Number)),
  lifecycleExecution: Schema.optional(Schema.Literal("terminal")),
  lifecycleGeneration: Schema.optional(Schema.Number),
  lifecycleGenerationAnchor: Schema.optional(Schema.String),
  lifecycleRestartAnchor: Schema.optional(Schema.NullOr(Schema.String)),
  onCompleteContext: Schema.optional(HistoricalOnCompleteContext),
  parentRetentionUntil: Schema.optional(Schema.NullOr(Schema.Number)),
  policySnapshot: Schema.optional(HistoricalPolicySnapshot),
  principalSnapshot: Schema.optional(HistoricalPrincipalSnapshot),
  priorGenerationQuiescence: Schema.optional(Schema.Literal("pending")),
});

export default Table.make(() => WorkflowRunRow)
  .index("by_workspace_status", ["workspaceId", "status"])
  .index("by_workflow_version", ["workflowId", "workflowVersion"])
  .index("by_idempotency_key", ["workspaceId", "idempotencyKey"])
  .index("by_component_workflow", ["componentWorkflowId"])
  .index("by_workspace_component_workflow", [
    "workspaceId",
    "componentWorkflowId",
  ]);
