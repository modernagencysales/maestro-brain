import { Table } from "@confect/server";
import * as Schema from "effect/Schema";
import { Id } from "../_generated/id";

export const CurrentPageRevisionRow = Schema.Struct({
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
});

const LegacyPageRevisionLifecycle = Schema.Struct({
  state: Schema.Literals(["active", "redacted", "purged"]),
  generation: Schema.Number,
  updatedAt: Schema.Number,
  purgeAfter: Schema.NullOr(Schema.Number),
});

export const LegacyPageRevisionRow = Schema.Struct({
  workspaceId: Id("workspaces"),
  organizationId: Schema.String,
  pageKey: Schema.String,
  revisionKey: Schema.String,
  priorRevisionKey: Schema.NullOr(Schema.String),
  blockNoteJson: Schema.String,
  markdown: Schema.String,
  contentHash: Schema.String,
  causation: Schema.Literals([
    "human-edit",
    "agent-edit",
    "import",
    "migration",
    "restore",
  ]),
  actor: Schema.Struct({
    kind: Schema.Literals(["user", "agent", "system", "migration"]),
    id: Schema.String,
  }),
  modelReceiptKey: Schema.NullOr(Schema.String),
  effectKey: Schema.String,
  state: Schema.Literals([
    "draft",
    "proposed",
    "published",
    "rejected",
    "redacted",
    "purged",
  ]),
  lifecycle: LegacyPageRevisionLifecycle,
  createdAt: Schema.Number,
  schemaVersion: Schema.Number,
});

export const PageRevisionRow = Schema.Union([
  CurrentPageRevisionRow,
  LegacyPageRevisionRow,
]);

// Immutable snapshots of every user-visible Brain page mutation. The legacy
// branch remains readable until the historical revision ledger is migrated.
export default Table.make(() => PageRevisionRow)
  .index("by_workspace", ["workspaceId"])
  .index("by_workspace_page_updated", ["workspaceId", "pageId", "updatedAt"])
  .index("by_workspace_ledger", ["workspaceId"])
  .index("by_workspace_revision_key", ["workspaceId", "revisionKey"])
  .index("by_page_created", ["workspaceId", "pageKey", "createdAt"])
  .index("by_page_hash", ["workspaceId", "pageKey", "contentHash"])
  .index("by_effect_key", ["workspaceId", "effectKey"]);
