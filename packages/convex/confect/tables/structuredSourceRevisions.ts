import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import {
  NonEmptyStructuredString,
  StructuredDigest,
  StructuredEntityKey,
  StructuredNonNegativeInteger,
  StructuredPositiveInteger,
  StructuredRevisionKey,
} from "../integrations/structuredLedgerSchemas";

export const StructuredSourceRevisionRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: NonEmptyStructuredString,
  providerKey: NonEmptyStructuredString,
  entityKind: NonEmptyStructuredString,
  providerEntityId: NonEmptyStructuredString,
  structuredEntityKey: StructuredEntityKey,
  structuredRevisionKey: StructuredRevisionKey,
  providerRevision: NonEmptyStructuredString,
  observationOrder: StructuredNonNegativeInteger,
  incarnation: StructuredPositiveInteger,
  tombstone: Schema.Boolean,
  fieldManifestHash: StructuredDigest,
  sourceModifiedAt: StructuredNonNegativeInteger,
  firstObservedAt: StructuredNonNegativeInteger,
  recordedAt: StructuredNonNegativeInteger,
});

export default Table.make(() => StructuredSourceRevisionRow)
  .index("by_organization", ["organizationKey"])
  .index("by_organization_revision_key", [
    "organizationKey",
    "structuredRevisionKey",
  ])
  .index("by_entity_incarnation_order", [
    "organizationKey",
    "structuredEntityKey",
    "incarnation",
    "observationOrder",
  ])
  .index("by_entity_provider_revision", [
    "organizationKey",
    "structuredEntityKey",
    "incarnation",
    "providerRevision",
  ]);
