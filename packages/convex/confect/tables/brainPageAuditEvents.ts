import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import { PageKey, RevisionKey } from "../brain/pageSchemas";

export const BrainPageAuditAction = Schema.Literal(
  "page.created",
  "page.renamed",
  "page.moved",
  "page.favoriteChanged",
  "page.archived",
  "page.restored",
);

export default Table.make(() =>
  Schema.Struct({
    workspaceId: Id("workspaces"),
    organizationId: Schema.String,
    brainKey: Schema.String,
    pageKey: PageKey,
    revisionKey: RevisionKey,
    actorUserId: Schema.String,
    action: BrainPageAuditAction,
    effectKey: Schema.String,
    metadata: Schema.Struct({}),
    createdAt: Schema.Number,
    schemaVersion: Schema.Number,
  }),
)
  .index("by_workspace_created", ["workspaceId", "createdAt"])
  .index("by_workspace_page_revision", [
    "workspaceId",
    "pageKey",
    "revisionKey",
  ])
  .index("by_workspace_effect", ["workspaceId", "effectKey"]);
