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
  connectionKey: Schema.optional(Schema.String),
  connectionGeneration: Schema.optional(NonNegativeInteger),
  sourceKey: Schema.String,
  sourceRevisionKey: Schema.String,
  routeGeneration: PositiveInteger,
  lifecycleGeneration: PositiveInteger,
  policyGeneration: PositiveInteger,
  eligibilityFences: Schema.optional(
    Schema.Array(RetrievalEligibilityFenceRef),
  ),
  eligibilityFenceBackfill: Schema.optional(
    Schema.Struct({
      runKey: Schema.String.pipe(Schema.pattern(/^pbrun_[a-f0-9]{64}$/)),
      runGeneration: PositiveInteger,
      configurationDigest: ContentHash,
      backfilledAt: NonNegativeInteger,
      scannedState: Schema.optional(Schema.Literal("current", "retired")),
      validationPass: Schema.optional(NonNegativeInteger),
      validatedAt: Schema.optional(NonNegativeInteger),
    }),
  ),
  expectedEntryCount: NonNegativeInteger,
  expectedTokenCount: NonNegativeInteger,
  manifestHash: ContentHash,
  state: Schema.Literal("building", "current", "retired", "failed"),
  citationInvalidationReceipt: Schema.optional(
    Schema.Struct({
      receiptKey: Schema.String.pipe(Schema.pattern(/^rcinv_[a-f0-9]{64}$/)),
      reason: Schema.Literal("retention_expired", "operator_invalidated"),
      invalidatedAt: NonNegativeInteger,
      receiptDigest: ContentHash,
    }),
  ),
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
