import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import {
  DocumentOutcomeKey,
  DriveConnectorScopeKey,
  DriveSourceOutcome,
  DriveSourceOutcomeReason,
  NonEmptyString,
  NonNegativeInteger,
  PositiveInteger,
} from "../integrations/driveLedgerSchemas";

export const DocumentSourceOutcomeRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: NonEmptyString,
  providerKey: Schema.Literal("google_drive"),
  outcomeKey: DocumentOutcomeKey,
  connectorScopeKey: DriveConnectorScopeKey,
  connectionKey: NonEmptyString,
  connectionGeneration: PositiveInteger,
  allowlistGeneration: PositiveInteger,
  providerObjectKey: NonEmptyString,
  providerRevisionKey: Schema.NullOr(NonEmptyString),
  sourceMimeType: Schema.NullOr(NonEmptyString),
  outcome: DriveSourceOutcome,
  reason: DriveSourceOutcomeReason,
  observedAt: NonNegativeInteger,
  recordedAt: NonNegativeInteger,
  ledgerSequence: Schema.optional(PositiveInteger),
});

export default Table.make(() => DocumentSourceOutcomeRow)
  .index("by_organization", ["organizationKey"])
  .index("by_organization_outcome_key", ["organizationKey", "outcomeKey"])
  .index("by_scope_outcome_observed", [
    "connectorScopeKey",
    "outcome",
    "observedAt",
  ])
  .index("by_scope_object_observed", [
    "connectorScopeKey",
    "providerObjectKey",
    "observedAt",
  ]);
