import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { PageKey, RevisionKey } from "../brain/pageSchemas";

export const CitationRow = Schema.Struct({
  workspaceId: Schema.String,
  citationId: Schema.String,
  claimId: Schema.String,
  sourceId: Schema.String,
  sourceKind: Schema.Literal(
    "markdown",
    "link",
    "note",
    "document",
    "call_transcript",
  ),
  sourceTitle: Schema.String,
  quotedText: Schema.String,
  startOffset: Schema.Number,
  endOffset: Schema.Number,
  pageKey: Schema.optional(PageKey),
  revisionKey: Schema.optional(RevisionKey),
  sourceUnitRevisionKey: Schema.optional(Schema.String),
  segmentKey: Schema.optional(Schema.String),
  startMs: Schema.optional(Schema.Number),
  endMs: Schema.optional(Schema.Number),
  createdAt: Schema.Number,
});

export default Table.make(() => CitationRow)
  .index("by_workspace", ["workspaceId"])
  .index("by_claim", ["claimId"])
  .index("by_source", ["sourceId"])
  .index("by_workspace_page", ["workspaceId", "pageKey"]);
