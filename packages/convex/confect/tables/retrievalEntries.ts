import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  ContentHash,
  NonNegativeInteger,
  PositiveInteger,
  RetrievalEntryKey,
  RetrievalOriginReference,
  RetrievalPassageKey,
  RetrievalPublicationSetKey,
  RetrievalPublicationSubjectKey,
} from "../brain/retrievalSchemas";

export const RetrievalEntryRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  publicationSubjectKey: Schema.optional(RetrievalPublicationSubjectKey),
  entryKey: RetrievalEntryKey,
  publicationSetKey: RetrievalPublicationSetKey,
  publicationGeneration: PositiveInteger,
  kind: Schema.Literal("page", "slack", "transcript", "document", "projection"),
  corpusKey: Schema.String,
  origin: RetrievalOriginReference,
  originTable: Schema.String,
  connectionKey: Schema.optional(Schema.String),
  connectionGeneration: Schema.optional(PositiveInteger),
  connectorScopeKey: Schema.optional(Schema.String),
  sourceKey: Schema.String,
  sourceRevisionKey: Schema.String,
  passageKey: RetrievalPassageKey,
  startOffset: NonNegativeInteger,
  endOffset: PositiveInteger,
  title: Schema.String,
  headingPath: Schema.NullOr(Schema.String),
  text: Schema.String,
  locator: Schema.optional(Schema.String),
  contentHash: ContentHash,
  sourceModifiedAt: Schema.optional(NonNegativeInteger),
  observedAt: NonNegativeInteger,
  indexedAt: NonNegativeInteger,
  authority: Schema.Literal("authoritative", "derived", "advisory"),
  authorityPolicyKey: Schema.String,
  policyGeneration: PositiveInteger,
  lifecycleGeneration: PositiveInteger,
  routeGeneration: PositiveInteger,
  state: Schema.Literal("building", "published", "revoked"),
});

export default Table.make(() => RetrievalEntryRow)
  .index("by_workspace_entry", ["workspaceId", "entryKey"])
  .index("by_workspace_brain_state_entry", [
    "workspaceId",
    "brainKey",
    "state",
    "entryKey",
  ])
  .index("by_workspace_brain_publication_set_entry", [
    "workspaceId",
    "brainKey",
    "publicationSetKey",
    "entryKey",
  ])
  .index("by_workspace_origin_revision_entry", [
    "workspaceId",
    "originTable",
    "sourceRevisionKey",
    "entryKey",
  ])
  .index("by_workspace_brain_revision_entry", [
    "workspaceId",
    "brainKey",
    "sourceRevisionKey",
    "entryKey",
  ])
  .index("by_workspace_connection_generation_state", [
    "workspaceId",
    "connectionKey",
    "connectionGeneration",
    "state",
  ])
  .index("by_workspace_scope_state", [
    "workspaceId",
    "connectorScopeKey",
    "state",
  ]);
