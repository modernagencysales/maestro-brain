import { DriveObservationOrder } from "@maestro-template/integrations/googleDrive/canonical";
import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import {
  DocumentMembershipEdgeKey,
  DocumentObjectKey,
  DocumentObservationKey,
  DocumentRevisionKey,
  DriveConnectorScopeKey,
  DriveHexDigest,
  DriveLedgerClassification,
  NonEmptyString,
  NonNegativeInteger,
  PositiveInteger,
} from "../integrations/driveLedgerSchemas";

export const DocumentSourceObservationRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: NonEmptyString,
  providerKey: Schema.Literal("google_drive"),
  observationKey: DocumentObservationKey,
  documentObjectKey: DocumentObjectKey,
  providerObjectKey: NonEmptyString,
  providerRevisionKey: NonEmptyString,
  connectorScopeKey: DriveConnectorScopeKey,
  connectionKey: NonEmptyString,
  connectionGeneration: PositiveInteger,
  allowlistGeneration: PositiveInteger,
  observationOrder: DriveObservationOrder,
  contentHash: DriveHexDigest,
  permissionSnapshotHash: DriveHexDigest,
  tombstone: Schema.Boolean,
  classification: DriveLedgerClassification,
  documentRevisionKey: Schema.NullOr(DocumentRevisionKey),
  membershipEdgeKey: Schema.NullOr(DocumentMembershipEdgeKey),
  incarnation: PositiveInteger,
  observedAt: NonNegativeInteger,
  recordedAt: NonNegativeInteger,
});

export default Table.make(() => DocumentSourceObservationRow)
  .index("by_organization", ["organizationKey"])
  .index("by_organization_observation_key", [
    "organizationKey",
    "observationKey",
  ])
  .index("by_scope_object_observed", [
    "connectorScopeKey",
    "documentObjectKey",
    "observedAt",
  ])
  .index("by_object_recorded", [
    "organizationKey",
    "documentObjectKey",
    "recordedAt",
  ]);
