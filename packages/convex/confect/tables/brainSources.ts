import { Table } from "@confect/server";
import * as Schema from "effect/Schema";
import { Id } from "../_generated/id";

export default Table.make(() =>
  Schema.Struct({
    workspaceId: Id("workspaces"),
    organizationId: Schema.String,
    sourceKey: Schema.String,
    title: Schema.String,
    markdown: Schema.String,
    status: Schema.Literal("pending_review", "published", "rejected"),
    submittedAt: Schema.Number,
    reviewedAt: Schema.optional(Schema.Number),
    schemaVersion: Schema.Number,
  }),
)
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_source_key", ["workspaceId", "sourceKey"])
  .index("by_workspace_status", ["workspaceId", "status"]);
