import { DriveObservationOrder } from "@maestro-template/integrations/googleDrive/canonical";
import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import {
  DocumentMembershipEdgeKey,
  DocumentObjectKey,
  DocumentObservationKey,
  DocumentRevisionKey,
  DriveConnectorScopeKey,
  NonEmptyString,
  NonNegativeInteger,
  PositiveInteger,
} from "../integrations/driveLedgerSchemas";

export const DocumentSourceMembershipEdgeRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: NonEmptyString,
  providerKey: Schema.Literal("google_drive"),
  membershipEdgeKey: DocumentMembershipEdgeKey,
  connectorScopeKey: DriveConnectorScopeKey,
  connectionKey: NonEmptyString,
  connectionGeneration: PositiveInteger,
  allowlistGeneration: PositiveInteger,
  documentObjectKey: DocumentObjectKey,
  documentRevisionKey: DocumentRevisionKey,
  observationKey: DocumentObservationKey,
  providerObjectKey: NonEmptyString,
  providerRevisionKey: NonEmptyString,
  observationOrder: DriveObservationOrder,
  membershipState: Schema.Literal("active", "tombstoned"),
  parentFolderIds: Schema.Array(NonEmptyString).pipe(Schema.maxItems(100)),
  incarnation: PositiveInteger,
  observedAt: NonNegativeInteger,
  recordedAt: NonNegativeInteger,
});

export default Table.make(() => DocumentSourceMembershipEdgeRow)
  .index("by_organization", ["organizationKey"])
  .index("by_organization_membership_edge_key", [
    "organizationKey",
    "membershipEdgeKey",
  ])
  .index("by_scope_tuple_object", [
    "connectorScopeKey",
    "connectionGeneration",
    "allowlistGeneration",
    "documentObjectKey",
  ])
  .index("by_scope_object_observed", [
    "connectorScopeKey",
    "documentObjectKey",
    "observedAt",
  ]);
