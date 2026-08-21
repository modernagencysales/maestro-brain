import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  ContentHash,
  NonNegativeInteger,
  PositiveInteger,
  RetrievalPublicationSetKey,
} from "../brain/retrievalSchemas";

export const RetrievalPublicationSetRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  corpusKey: Schema.String,
  publicationSetKey: RetrievalPublicationSetKey,
  publicationGeneration: PositiveInteger,
  originKind: Schema.Literal(
    "page",
    "slack",
    "transcript",
    "document",
    "projection",
  ),
  originTable: Schema.String,
  sourceKey: Schema.String,
  sourceRevisionKey: Schema.String,
  routeGeneration: PositiveInteger,
  lifecycleGeneration: PositiveInteger,
  policyGeneration: PositiveInteger,
  expectedEntryCount: NonNegativeInteger,
  expectedTokenCount: NonNegativeInteger,
  manifestHash: ContentHash,
  state: Schema.Literal("building", "current", "retired", "failed"),
  createdAt: NonNegativeInteger,
  activatedAt: Schema.optional(NonNegativeInteger),
  retiredAt: Schema.optional(NonNegativeInteger),
  failureReason: Schema.optional(Schema.String),
});

export default Table.make(() => RetrievalPublicationSetRow)
  .index("by_workspace_publication_set", ["workspaceId", "publicationSetKey"])
  .index("by_workspace_brain_source_state_generation", [
    "workspaceId",
    "brainKey",
    "originTable",
    "sourceKey",
    "state",
    "publicationGeneration",
  ])
  .index("by_workspace_brain_state_publication_set", [
    "workspaceId",
    "brainKey",
    "state",
    "publicationSetKey",
  ]);
