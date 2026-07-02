import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export default Table.make(() =>
  Schema.Struct({
    workspaceId: Schema.String,
    digestId: Schema.String,
    recipientId: Schema.String,
    periodStart: Schema.Number,
    periodEnd: Schema.Number,
    jobsQueued: Schema.Number,
    approvalsWaiting: Schema.Number,
    actionsPublished: Schema.Number,
    dedupeKey: Schema.String,
    providerMetadataRedacted: Schema.Literal("[redacted]"),
    customerMetadataRedacted: Schema.Literal("[redacted]"),
    createdAt: Schema.Number,
    sentAt: Schema.optional(Schema.Number),
  }),
)
  .index("by_workspace", ["workspaceId"])
  .index("by_recipient", ["workspaceId", "recipientId"])
  .index("by_dedupe_key", ["workspaceId", "dedupeKey"]);
