import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { NonNegativeInteger } from "../brain/retrievalSchemas";

export const RetrievalRebuildChildRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  rebuildRunKey: Schema.String.pipe(Schema.pattern(/^rrun_[a-f0-9]{64}$/)),
  childJobKey: Schema.String.pipe(Schema.pattern(/^rjob_[a-f0-9]{64}$/)),
  parentBatchJobKey: Schema.String.pipe(Schema.pattern(/^rjob_[a-f0-9]{64}$/)),
  originKind: Schema.Literal("page", "slack", "transcript"),
  operation: Schema.Literal("publish", "cleanup"),
  sourceKey: Schema.String,
  sourceRevisionKey: Schema.String,
  status: Schema.Literal(
    "pending",
    "published",
    "revoked",
    "superseded",
    "blocked",
  ),
  createdAt: NonNegativeInteger,
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => RetrievalRebuildChildRow)
  .index("by_child_job_key", ["childJobKey"])
  .index("by_run_child", ["rebuildRunKey", "childJobKey"])
  .index("by_run_status_child", ["rebuildRunKey", "status", "childJobKey"]);
