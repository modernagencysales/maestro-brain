import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  NonNegativeInteger,
  RetrievalPublicationSetKey,
  RetrievalPublicationSubjectKey,
} from "../brain/retrievalSchemas";

export const RetrievalPublicationSubjectRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  corpusKey: Schema.String,
  publicationSubjectKey: RetrievalPublicationSubjectKey,
  originKind: Schema.Literal(
    "page",
    "slack",
    "transcript",
    "document",
    "projection",
  ),
  originTable: Schema.String,
  sourceKey: Schema.String,
  connectorScopeKey: Schema.optional(Schema.String),
  currentPublicationSetKey: Schema.NullOr(RetrievalPublicationSetKey),
  lastPublicationGeneration: NonNegativeInteger,
  createdAt: NonNegativeInteger,
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => RetrievalPublicationSubjectRow)
  .index("by_workspace_subject", ["workspaceId", "publicationSubjectKey"])
  .index("by_workspace_brain_subject", [
    "workspaceId",
    "brainKey",
    "publicationSubjectKey",
  ]);
