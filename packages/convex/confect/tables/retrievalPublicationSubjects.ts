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
  connectionKey: Schema.optional(Schema.String),
  connectionGeneration: Schema.optional(NonNegativeInteger),
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
  ])
  .index("by_workspace_brain_corpus_subject", [
    "workspaceId",
    "brainKey",
    "corpusKey",
    "publicationSubjectKey",
  ])
  .index("by_workspace_brain_corpus_connector_subject", [
    "workspaceId",
    "brainKey",
    "corpusKey",
    "connectorScopeKey",
    "publicationSubjectKey",
  ])
  .index("by_workspace_brain_corpus_connection_subject", [
    "workspaceId",
    "brainKey",
    "corpusKey",
    "connectionKey",
    "connectionGeneration",
    "publicationSubjectKey",
  ]);
