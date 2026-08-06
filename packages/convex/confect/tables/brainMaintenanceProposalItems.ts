import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";

export default Table.make(() =>
  Schema.Struct({
    workspaceId: Id("workspaces"),
    brainKey: Schema.String,
    proposalKey: Schema.String,
    itemKey: Schema.String,
    pageKey: Schema.String,
    expectedRevisionKey: Schema.String,
    pageLifecycleGeneration: Schema.Number,
    title: Schema.String,
    markdown: Schema.String,
    citationKeys: Schema.Array(Schema.String),
    status: Schema.Literal(
      "awaiting_review",
      "published",
      "edited_and_published",
      "rejected",
      "superseded",
      "revoked",
    ),
    createdAt: Schema.Number,
    updatedAt: Schema.Number,
  }),
)
  .index("by_workspace_proposal", ["workspaceId", "proposalKey"])
  .index("by_workspace_item", ["workspaceId", "itemKey"])
  .index("by_workspace_page_status", ["workspaceId", "pageKey", "status"]);
