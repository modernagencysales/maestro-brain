import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  ContentHash,
  NonNegativeInteger,
  PositiveInteger,
} from "../brain/retrievalSchemas";

const NonNegativeNumber = Schema.Number.pipe(Schema.greaterThanOrEqualTo(0));

export const ConnectorReconciliationSeenRow = Schema.Struct({
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
  seenMarkerKey: Schema.String.pipe(Schema.pattern(/^cseen_[a-f0-9]{64}$/)),
  reconciliationRunKey: Schema.String.pipe(
    Schema.pattern(/^crun_[a-f0-9]{64}$/),
  ),
  runGeneration: PositiveInteger,
  membershipKey: Schema.String,
  providerObjectKey: Schema.String,
  originKind: Schema.Literal("slack", "transcript"),
  originKey: Schema.String,
  originRevisionKey: Schema.String,
  ledgerSequence: NonNegativeNumber,
  observationDigest: ContentHash,
  seenAt: NonNegativeInteger,
});

export default Table.make(() => ConnectorReconciliationSeenRow)
  .index("by_seen_marker_key", ["seenMarkerKey"])
  .index("by_run_membership", ["reconciliationRunKey", "membershipKey"])
  .index("by_run_ledger_sequence", ["reconciliationRunKey", "ledgerSequence"])
  .index("by_scope_tuple_membership", [
    "connectorScopeKey",
    "connectionGeneration",
    "allowlistGeneration",
    "membershipKey",
  ]);
