import { Table } from "@confect/server";
import * as Schema from "effect/Schema";
import { Id } from "../_generated/id";

// Immutable snapshots of every user-visible Brain page mutation.
export default Table.make(() =>
  Schema.Struct({
    workspaceId: Id("workspaces"),
    pageId: Id("brainPages"),
    priorUpdatedAt: Schema.NullOr(Schema.Number),
    updatedAt: Schema.Number,
    title: Schema.String,
    markdown: Schema.String,
    sourceKind: Schema.Literals(["markdown", "link", "note"]),
    causation: Schema.Literals([
      "create",
      "update",
      "rename",
      "move",
      "favorite",
      "archive",
      "restore",
    ]),
    parentPageId: Schema.NullOr(Id("brainPages")),
    sortKey: Schema.String,
    favorite: Schema.Boolean,
    status: Schema.Literals(["active", "archived"]),
    actorUserId: Id("users"),
    createdAt: Schema.Number,
  }),
)
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_page_updated", ["workspaceId", "pageId", "updatedAt"]);
