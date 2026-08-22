import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import { NonNegativeInteger, PositiveInteger } from "../brain/retrievalSchemas";

export const BrainCorpusHealthRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  corpusKey: Schema.String,
  connectorScopeKey: Schema.optional(Schema.String),
  connectionGeneration: Schema.optional(PositiveInteger),
  policyGeneration: PositiveInteger,
  reconciliationGeneration: Schema.optional(PositiveInteger),
  coverageStatus: Schema.Literal(
    "complete",
    "partial",
    "unavailable",
    "unknown",
  ),
  lastObservedAt: Schema.optional(NonNegativeInteger),
  lastPublishedAt: Schema.optional(NonNegativeInteger),
  lastReconciledAt: Schema.optional(NonNegativeInteger),
  freshnessThresholdMs: NonNegativeInteger,
  discoveredCount: NonNegativeInteger,
  publishedCount: NonNegativeInteger,
  failedCount: NonNegativeInteger,
  degradedReason: Schema.optional(Schema.String),
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => BrainCorpusHealthRow)
  .index("by_workspace_brain_corpus_scope", [
    "workspaceId",
    "brainKey",
    "corpusKey",
    "connectorScopeKey",
  ])
  .index("by_workspace_brain_corpus_scope_connection", [
    "workspaceId",
    "brainKey",
    "corpusKey",
    "connectorScopeKey",
    "connectionGeneration",
  ])
  .index("by_workspace_brain", ["workspaceId", "brainKey"]);
