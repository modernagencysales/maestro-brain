import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import {
  DocumentObjectKey,
  DocumentRevisionKey,
  DriveCanonicalRevisionSchema,
  NonEmptyString,
  NonNegativeInteger,
  PositiveInteger,
} from "../integrations/driveLedgerSchemas";

export const DocumentSourceRevisionRow = Schema.extend(
  DriveCanonicalRevisionSchema,
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    organizationKey: NonEmptyString,
    documentObjectKey: DocumentObjectKey,
    documentRevisionKey: DocumentRevisionKey,
    incarnation: PositiveInteger,
    recordedAt: NonNegativeInteger,
  }),
);

export default Table.make(() => DocumentSourceRevisionRow)
  .index("by_organization", ["organizationKey"])
  .index("by_organization_revision_key", [
    "organizationKey",
    "documentRevisionKey",
  ])
  .index("by_object_incarnation_recorded", [
    "organizationKey",
    "documentObjectKey",
    "incarnation",
    "recordedAt",
  ])
  .index("by_scope_object_recorded", [
    "connectorScopeKey",
    "documentObjectKey",
    "recordedAt",
  ]);
