import { Table } from "@confect/server";
import * as Schema from "effect/Schema";
import { Id } from "../_generated/id";

const LegacyBrainPageLifecycle = Schema.Struct({
  state: Schema.Literals(["active", "archived", "redacted", "purged"]),
  generation: Schema.Number,
  updatedAt: Schema.Number,
  purgeAfter: Schema.NullOr(Schema.Number),
});

export const BrainPageRow = Schema.Struct({
  workspaceId: Id("workspaces"),
  organizationId: Schema.optional(Schema.String),
  slug: Schema.String,
  title: Schema.String,
  markdown: Schema.String,
  editorSnapshotJson: Schema.optional(Schema.String),
  editorSnapshotVersion: Schema.optional(Schema.Number),
  sourceKind: Schema.Literals(["markdown", "link", "note"]),
  parentPageId: Schema.optional(Schema.NullOr(Id("brainPages"))),
  pageKey: Schema.optional(Schema.String),
  parentPageKey: Schema.optional(Schema.NullOr(Schema.String)),
  siblingSlug: Schema.optional(Schema.String),
  sortKey: Schema.optional(Schema.String),
  favorite: Schema.optional(Schema.Boolean),
  status: Schema.optional(Schema.Literals(["active", "archived"])),
  currentRevisionKey: Schema.optional(Schema.NullOr(Schema.String)),
  lifecycle: Schema.optional(LegacyBrainPageLifecycle),
  createdAt: Schema.optional(Schema.Number),
  schemaVersion: Schema.optional(Schema.Number),
  updatedAt: Schema.Number,
});

export default Table.make(() => BrainPageRow)
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_slug", ["workspaceId", "slug"])
  .index("by_workspace_status", ["workspaceId", "status"])
  .index("by_workspace_parent_sort", [
    "workspaceId",
    "parentPageId",
    "sortKey",
  ]);
