import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  NonNegativeInteger,
  RetrievalEntryKey,
  RetrievalPublicationSetKey,
} from "../brain/retrievalSchemas";

export const RetrievalTokenRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  publicationSetKey: RetrievalPublicationSetKey,
  publicationState: Schema.optional(Schema.Literal("current", "retired")),
  tokenizerVersion: Schema.Literal(1),
  token: Schema.String,
  entryKey: RetrievalEntryKey,
  corpusKey: Schema.optional(Schema.String),
  evidenceAt: Schema.optional(NonNegativeInteger),
  authorityRank: Schema.Literal(1, 2, 3),
  termFrequency: NonNegativeInteger,
  inTitle: Schema.Boolean,
  inHeading: Schema.Boolean,
});

export default Table.make(() => RetrievalTokenRow)
  .index("by_workspace_brain_token_authority_entry", [
    "workspaceId",
    "brainKey",
    "token",
    "authorityRank",
    "entryKey",
  ])
  .index("by_workspace_brain_token_publication_state_authority_entry", [
    "workspaceId",
    "brainKey",
    "token",
    "publicationState",
    "authorityRank",
    "entryKey",
  ])
  .index("by_workspace_brain_publication_set_entry", [
    "workspaceId",
    "brainKey",
    "publicationSetKey",
    "entryKey",
  ])
  .index("by_workspace_entry", ["workspaceId", "entryKey"]);
