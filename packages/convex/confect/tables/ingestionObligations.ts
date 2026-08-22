import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import { NonNegativeInteger, PositiveInteger } from "../brain/retrievalSchemas";

const NonNegativeNumber = Schema.Number.pipe(Schema.greaterThanOrEqualTo(0));

export const IngestionObligationState = Schema.Literal(
  "captured",
  "normalization_pending",
  "quarantined",
  "target_resolution_pending",
  "capacity_blocked",
  "publication_pending",
  "retry_wait",
  "removal_pending",
  "drain_pending",
  "complete",
  "policy_excluded",
  "failed",
);

export const IngestionObligationRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  corpusKey: Schema.Literal("slack", "transcripts"),
  providerKind: Schema.Literal("slack", "transcript"),
  connectorScopeKey: Schema.String,
  connectionKey: Schema.String,
  connectionGeneration: PositiveInteger,
  allowlistGeneration: PositiveInteger,
  ingestionObligationKey: Schema.String.pipe(
    Schema.pattern(/^iobl_[a-f0-9]{64}$/),
  ),
  requiredScopeIntentKey: Schema.String.pipe(
    Schema.pattern(/^brsi_[a-f0-9]{64}$/),
  ),
  reconciliationRunKey: Schema.String.pipe(
    Schema.pattern(/^crun_[a-f0-9]{64}$/),
  ),
  runGeneration: PositiveInteger,
  cause: Schema.Literal("observation", "removal"),
  membershipKey: Schema.String,
  originKind: Schema.Literal("slack", "transcript"),
  originKey: Schema.String,
  originRevisionKey: Schema.String,
  ledgerSequence: NonNegativeNumber,
  state: IngestionObligationState,
  targetResolutionIntentKey: Schema.NullOr(Schema.String),
  publicationJobKeys: Schema.Array(Schema.String).pipe(Schema.maxItems(100)),
  errorTag: Schema.NullOr(Schema.String),
  terminalAt: Schema.NullOr(NonNegativeInteger),
  createdAt: NonNegativeInteger,
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => IngestionObligationRow)
  .index("by_ingestion_obligation_key", ["ingestionObligationKey"])
  .index("by_run_ledger_sequence", ["reconciliationRunKey", "ledgerSequence"])
  .index("by_run_state_ledger_sequence", [
    "reconciliationRunKey",
    "state",
    "ledgerSequence",
  ])
  .index("by_scope_tuple_state_ledger", [
    "connectorScopeKey",
    "connectionGeneration",
    "allowlistGeneration",
    "state",
    "ledgerSequence",
  ])
  .index("by_required_intent_state", ["requiredScopeIntentKey", "state"])
  .index("by_origin_revision", [
    "organizationKey",
    "originKind",
    "originRevisionKey",
  ]);
