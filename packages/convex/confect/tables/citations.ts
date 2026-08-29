import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export const CitationRow = Schema.Struct({
  // Kept string-compatible through the fixture-to-real migration window.
  // New writers still supply a validated workspace Id at their boundary.
  workspaceId: Schema.String,
  citationId: Schema.String,
  claimId: Schema.String,
  sourceId: Schema.String,
  sourceKind: Schema.Literals([
    "markdown",
    "link",
    "note",
    "document",
    "call_transcript",
    "slack_thread",
  ]),
  sourceTitle: Schema.String,
  quotedText: Schema.String,
  startOffset: Schema.Number,
  endOffset: Schema.Number,
  pageKey: Schema.optional(Schema.String),
  revisionKey: Schema.optional(Schema.String),
  sourceUnitRevisionKey: Schema.optional(Schema.String),
  segmentKey: Schema.optional(Schema.String),
  startMs: Schema.optional(Schema.Number),
  endMs: Schema.optional(Schema.Number),
  sourceKey: Schema.optional(Schema.String),
  contentHash: Schema.optional(Schema.String),
  locator: Schema.optional(Schema.String),
  provider: Schema.optional(
    Schema.Literals([
      "slack",
      "google_drive",
      "brain_page",
      "hubspot",
      "transcript",
    ]),
  ),
  createdAt: Schema.Number,
});

export default Table.make(() => CitationRow)
  .index("by_workspace", ["workspaceId"])
  .index("by_claim", ["claimId"])
  .index("by_source", ["sourceId"])
  .index("by_workspace_page", ["workspaceId", "pageKey"])
  .index("by_workspace_and_source_key", ["workspaceId", "sourceKey"])
  .index("by_workspace_and_source_key_and_revision_key", [
    "workspaceId",
    "sourceKey",
    "revisionKey",
  ]);
