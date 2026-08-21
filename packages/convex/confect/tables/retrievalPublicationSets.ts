import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  ContentHash,
  NonNegativeInteger,
  PositiveInteger,
  RetrievalEligibilityFenceRef,
  RetrievalPublicationSetKey,
  RetrievalPublicationSubjectKey,
} from "../brain/retrievalSchemas";

export const RetrievalPublicationSetRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  corpusKey: Schema.String,
  publicationSubjectKey: Schema.optional(RetrievalPublicationSubjectKey),
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
  connectorScopeKey: Schema.optional(Schema.String),
  sourceKey: Schema.String,
  sourceRevisionKey: Schema.String,
  routeGeneration: PositiveInteger,
  lifecycleGeneration: PositiveInteger,
  policyGeneration: PositiveInteger,
  eligibilityFences: Schema.optional(
    Schema.Array(RetrievalEligibilityFenceRef),
  ),
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
  .index("by_workspace_subject_generation", [
    "workspaceId",
    "publicationSubjectKey",
    "publicationGeneration",
  ])
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
