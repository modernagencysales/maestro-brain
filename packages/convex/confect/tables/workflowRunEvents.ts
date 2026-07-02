import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export default Table.make(() =>
  Schema.Struct({
    workflowRunId: Schema.String,
    sequence: Schema.Number,
    type: Schema.String,
    nodeId: Schema.NullOr(Schema.String),
    payloadJson: Schema.String,
    createdAt: Schema.Number,
  }),
)
  .index("by_run_sequence", ["workflowRunId", "sequence"])
  .index("by_run_type", ["workflowRunId", "type"]);
