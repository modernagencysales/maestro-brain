import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export default Table.make(() =>
  Schema.Struct({
    documentId: Schema.String,
    workspaceId: Schema.String,
    versionId: Schema.String,
    priorVersionId: Schema.optional(Schema.String),
    markdown: Schema.String,
    authorType: Schema.Literal("human", "agent"),
    authorId: Schema.String,
    sourceKind: Schema.Literal("markdown", "link", "note", "document"),
    sourceTitle: Schema.String,
    sourceIds: Schema.Array(Schema.String),
    createdAt: Schema.Number,
  }),
)
  .index("by_document", ["documentId"])
  .index("by_document_version", ["documentId", "versionId"])
  .index("by_workspace", ["workspaceId"]);
