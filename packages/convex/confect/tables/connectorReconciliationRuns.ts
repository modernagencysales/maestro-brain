import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  ContentHash,
  NonNegativeInteger,
  PositiveInteger,
} from "../brain/retrievalSchemas";

const NonNegativeNumber = Schema.Number.pipe(Schema.greaterThanOrEqualTo(0));

export const ConnectorReconciliationRunStatus = Schema.Literal(
  "scan",
  "traversal_closed",
  "apply_removals",
  "drain_derived",
  "complete",
  "superseded",
  "blocked",
);

const ReconciliationCompletionReceipt = Schema.Struct({
  providerHighWater: Schema.NullOr(Schema.String),
  ledgerHighWater: NonNegativeNumber,
  successfulObligationCount: NonNegativeInteger,
  blockingObligationCount: NonNegativeInteger,
  completedAt: NonNegativeInteger,
  receiptDigest: ContentHash,
});

export const ConnectorReconciliationRunRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  corpusKey: Schema.Literal("slack", "transcripts", "documents"),
  providerKind: Schema.Literal("slack", "transcript", "google_drive"),
  connectorScopeKey: Schema.String,
  connectionKey: Schema.String,
  connectionGeneration: PositiveInteger,
  allowlistGeneration: PositiveInteger,
  reconciliationRunKey: Schema.String.pipe(
    Schema.pattern(/^crun_[a-f0-9]{64}$/),
  ),
  runGeneration: PositiveInteger,
  scopeTupleDigest: ContentHash,
  status: ConnectorReconciliationRunStatus,
  providerHighWater: Schema.NullOr(Schema.String),
  ledgerHighWater: NonNegativeNumber,
  leaseId: Schema.String,
  leaseGeneration: PositiveInteger,
  leaseExpiresAt: NonNegativeInteger,
  scanCursor: Schema.NullOr(Schema.String),
  removalCursor: Schema.NullOr(Schema.String),
  drainCursor: Schema.NullOr(Schema.String),
  observedCount: NonNegativeInteger,
  obligationCount: NonNegativeInteger,
  removalCandidateCount: NonNegativeInteger,
  removalRequiredCount: NonNegativeInteger,
  removalBacklogCount: NonNegativeInteger,
  drainedCount: NonNegativeInteger,
  drainBacklogCount: NonNegativeInteger,
  blockingObligationCount: NonNegativeInteger,
  completionReceipt: Schema.NullOr(ReconciliationCompletionReceipt),
  openedAt: NonNegativeInteger,
  completedAt: Schema.NullOr(NonNegativeInteger),
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => ConnectorReconciliationRunRow)
  .index("by_reconciliation_run_key", ["reconciliationRunKey"])
  .index("by_scope_run_generation", ["connectorScopeKey", "runGeneration"])
  .index("by_status_updated", ["status", "updatedAt"])
  .index("by_status_lease_expiry", ["status", "leaseExpiresAt"]);
