import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import {
  DocumentObjectKey,
  DocumentRevisionKey,
  DriveConnectorScopeKey,
  DrivePassageRowFields,
  NonEmptyString,
  NonNegativeInteger,
  PositiveInteger,
} from "../integrations/driveLedgerSchemas";

export const DocumentSourcePassageRow = Schema.extend(
  DrivePassageRowFields,
  Schema.Struct({
    schemaVersion: Schema.Literal(1),
    organizationKey: NonEmptyString,
    connectorScopeKey: DriveConnectorScopeKey,
    documentObjectKey: DocumentObjectKey,
    documentRevisionKey: DocumentRevisionKey,
    providerObjectKey: NonEmptyString,
    providerRevisionKey: NonEmptyString,
    sourceLocator: NonEmptyString,
    normalizationVersion: Schema.Literal(1),
    incarnation: PositiveInteger,
    recordedAt: NonNegativeInteger,
  }),
);

export default Table.make(() => DocumentSourcePassageRow)
  .index("by_organization", ["organizationKey"])
  .index("by_organization_passage_key", ["organizationKey", "passageKey"])
  .index("by_revision_ordinal", ["documentRevisionKey", "ordinal"])
  .index("by_scope_object_recorded", [
    "connectorScopeKey",
    "documentObjectKey",
    "recordedAt",
  ]);
