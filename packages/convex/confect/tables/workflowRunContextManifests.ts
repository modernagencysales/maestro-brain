import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export default Table.make(() =>
  Schema.Struct({
    workflowRunId: Schema.String,
    manifestHash: Schema.String,
    sourceSnapshotIds: Schema.Array(Schema.String),
    policySnapshotId: Schema.String,
    promptRef: Schema.String,
    modelReceiptId: Schema.String,
    manifestJson: Schema.String,
    createdAt: Schema.Number,
  }),
)
  .index("by_run", ["workflowRunId"])
  .index("by_manifest_hash", ["manifestHash"]);
