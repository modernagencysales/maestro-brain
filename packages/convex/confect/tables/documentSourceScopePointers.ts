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

export const DocumentSourceScopePointerRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: NonEmptyString,
  connectorScopeKey: DriveConnectorScopeKey,
  connectionKey: NonEmptyString,
  connectionGeneration: PositiveInteger,
  allowlistGeneration: PositiveInteger,
  documentObjectKey: DocumentObjectKey,
  currentRevisionKey: DocumentRevisionKey,
  currentObservationKey: DocumentObservationKey,
  currentMembershipEdgeKey: DocumentMembershipEdgeKey,
  currentObservationOrder: DriveObservationOrder,
  lifecycleState: Schema.Literal("live", "tombstoned"),
  incarnation: PositiveInteger,
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => DocumentSourceScopePointerRow)
  .index("by_organization", ["organizationKey"])
  .index("by_scope_tuple_object", [
    "connectorScopeKey",
    "connectionGeneration",
    "allowlistGeneration",
    "documentObjectKey",
  ])
  .index("by_organization_object", ["organizationKey", "documentObjectKey"]);
