import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import {
  NonEmptyStructuredString,
  StructuredEntityKey,
  StructuredNonNegativeInteger,
  StructuredObservationKey,
  StructuredPositiveInteger,
  StructuredRevisionKey,
} from "../integrations/structuredLedgerSchemas";

export const StructuredSourceEntityRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: NonEmptyStructuredString,
  providerKey: NonEmptyStructuredString,
  entityKind: NonEmptyStructuredString,
  providerEntityId: NonEmptyStructuredString,
  structuredEntityKey: StructuredEntityKey,
  lifecycleState: Schema.Literal("live", "tombstoned"),
  lifecycleGeneration: StructuredPositiveInteger,
  incarnation: StructuredPositiveInteger,
  currentRevisionKey: StructuredRevisionKey,
  currentObservationKey: StructuredObservationKey,
  currentObservationOrder: StructuredNonNegativeInteger,
  createdAt: StructuredNonNegativeInteger,
  updatedAt: StructuredNonNegativeInteger,
});

export default Table.make(() => StructuredSourceEntityRow)
  .index("by_organization", ["organizationKey"])
  .index("by_organization_entity_key", [
    "organizationKey",
    "structuredEntityKey",
  ])
  .index("by_organization_provider_entity", [
    "organizationKey",
    "providerKey",
    "entityKind",
    "providerEntityId",
  ])
  .index("by_organization_kind_lifecycle", [
    "organizationKey",
    "entityKind",
    "lifecycleState",
  ]);
