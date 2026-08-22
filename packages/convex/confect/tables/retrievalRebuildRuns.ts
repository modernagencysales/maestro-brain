import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  ContentHash,
  NonNegativeInteger,
  PositiveInteger,
} from "../brain/retrievalSchemas";

const NonNegativeNumber = Schema.Number.pipe(Schema.greaterThanOrEqualTo(0));

const RebuildConfiguration = Schema.Struct({
  requestGeneration: PositiveInteger,
  policyGeneration: Schema.optional(PositiveInteger),
  routeGeneration: Schema.optional(PositiveInteger),
  connectionGeneration: Schema.optional(PositiveInteger),
});

const EligibilityFenceSnapshot = Schema.Struct({
  kind: Schema.Literal(
    "lifecycle",
    "route",
    "policy",
    "scope",
    "allowlist",
    "connection",
  ),
  fenceKey: Schema.String,
  eligibilityGeneration: PositiveInteger,
  eligible: Schema.Boolean,
  controllerKey: Schema.String,
});

const CompletionReceipt = Schema.Struct({
  catchupHighWater: NonNegativeNumber,
  catchupStateDigest: ContentHash,
  scanDigest: ContentHash,
  catchupDigest: ContentHash,
  setDifferenceDigest: ContentHash,
  finalChainDigest: ContentHash,
  emittedChildCount: NonNegativeInteger,
  terminalChildCount: NonNegativeInteger,
  publishedChildCount: NonNegativeInteger,
  revokedChildCount: NonNegativeInteger,
  completedAt: NonNegativeInteger,
  receiptDigest: ContentHash,
});

export const RetrievalRebuildRunRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  rebuildRunKey: Schema.String.pipe(Schema.pattern(/^rrun_[a-f0-9]{64}$/)),
  rebuildScopeKey: Schema.String,
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  corpusKey: Schema.Literal("brain-pages", "slack", "transcripts"),
  originKind: Schema.Literal(
    "page_rebuild",
    "slack_rebuild",
    "transcript_rebuild",
  ),
  scopeKind: Schema.Literal(
    "workspace",
    "connector_scope",
    "connection",
    "corpus",
  ),
  scopeValue: Schema.String,
  connectorScopeKey: Schema.optional(Schema.String),
  connectionKey: Schema.optional(Schema.String),
  triggerSourceKey: Schema.String,
  triggerRevisionKey: Schema.String,
  runGeneration: PositiveInteger,
  configuration: RebuildConfiguration,
  configurationDigest: ContentHash,
  eligibilityFences: Schema.Array(EligibilityFenceSnapshot).pipe(
    Schema.maxItems(6),
  ),
  runAuthorityDigest: ContentHash,
  ledgerHighWater: NonNegativeNumber,
  ledgerStateDigest: Schema.optional(ContentHash),
  pauseEpoch: NonNegativeInteger,
  rootPredecessorDigest: ContentHash,
  openedAt: NonNegativeInteger,
  status: Schema.Literal(
    "running",
    "closing",
    "complete",
    "superseded",
    "blocked",
  ),
  headDigest: ContentHash,
  catchupHighWater: Schema.optional(NonNegativeNumber),
  catchupStateDigest: Schema.optional(ContentHash),
  scanDigest: Schema.optional(ContentHash),
  catchupDigest: Schema.optional(ContentHash),
  setDifferenceDigest: Schema.optional(ContentHash),
  emittedChildCount: NonNegativeInteger,
  terminalChildCount: NonNegativeInteger,
  blockingChildCount: NonNegativeInteger,
  publishedChildCount: NonNegativeInteger,
  revokedChildCount: NonNegativeInteger,
  supersededChildCount: NonNegativeInteger,
  completionReceipt: Schema.optional(CompletionReceipt),
  blockingErrorTag: Schema.optional(Schema.String),
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => RetrievalRebuildRunRow)
  .index("by_run_key", ["rebuildRunKey"])
  .index("by_scope_generation", ["rebuildScopeKey", "runGeneration"])
  .index("by_workspace_brain_status", [
    "workspaceId",
    "brainKey",
    "status",
    "rebuildRunKey",
  ]);
