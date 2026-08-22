import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import {
  DocumentObjectKey,
  NonEmptyString,
  NonNegativeInteger,
  PositiveInteger,
} from "../integrations/driveLedgerSchemas";

export const DocumentSourceObjectRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: NonEmptyString,
  providerKey: Schema.Literal("google_drive"),
  documentObjectKey: DocumentObjectKey,
  providerObjectKey: NonEmptyString,
  lifecycleState: Schema.Literal("live", "tombstoned"),
  incarnation: PositiveInteger,
  createdAt: NonNegativeInteger,
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => DocumentSourceObjectRow)
  .index("by_organization", ["organizationKey"])
  .index("by_organization_object_key", ["organizationKey", "documentObjectKey"])
  .index("by_organization_provider_object", [
    "organizationKey",
    "providerKey",
    "providerObjectKey",
  ])
  .index("by_organization_lifecycle", ["organizationKey", "lifecycleState"]);
