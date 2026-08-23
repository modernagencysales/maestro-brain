import { Table } from "@confect/server";
import * as Schema from "effect/Schema";
import { Id } from "../_generated/id";

export default Table.make(() =>
  Schema.Struct({
    workspaceId: Id("workspaces"),
    slug: Schema.String,
    title: Schema.String,
    markdown: Schema.String,
    editorSnapshotJson: Schema.optional(Schema.String),
    editorSnapshotVersion: Schema.optional(Schema.Number),
    sourceKind: Schema.Literals(["markdown", "link", "note"]),
    parentPageId: Schema.optional(Schema.NullOr(Id("brainPages"))),
    sortKey: Schema.optional(Schema.String),
    favorite: Schema.optional(Schema.Boolean),
    status: Schema.optional(Schema.Literals(["active", "archived"])),
    createdAt: Schema.optional(Schema.Number),
    updatedAt: Schema.Number,
  }),
)
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_slug", ["workspaceId", "slug"])
  .index("by_workspace_status", ["workspaceId", "status"])
  .index("by_workspace_parent_sort", [
    "workspaceId",
    "parentPageId",
    "sortKey",
  ]);
