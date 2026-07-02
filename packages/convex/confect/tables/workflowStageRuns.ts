import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export default Table.make(() =>
  Schema.Struct({
    workflowRunId: Schema.String,
    nodeId: Schema.String,
    kind: Schema.Literal("source", "capability", "agent", "approval", "output"),
    label: Schema.String,
    status: Schema.Literal(
      "queued",
      "running",
      "completed",
      "failed",
      "skipped",
    ),
    attempt: Schema.Number,
    startedAt: Schema.Number,
    completedAt: Schema.NullOr(Schema.Number),
    errorJson: Schema.NullOr(Schema.String),
    outputJson: Schema.NullOr(Schema.String),
  }),
)
  .index("by_run", ["workflowRunId"])
  .index("by_run_node", ["workflowRunId", "nodeId"])
  .index("by_status", ["status"]);
