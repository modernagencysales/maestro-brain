import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import {
  NonEmptyStructuredString,
  StructuredAuthority,
  StructuredDigest,
  StructuredEligibilityManifest,
  StructuredEntityKey,
  StructuredFieldKey,
  StructuredNonNegativeInteger,
  StructuredObservationKey,
  StructuredPositiveInteger,
  StructuredRevisionKey,
  StructuredRouteKey,
  StructuredValue,
  StructuredValueType,
} from "../integrations/structuredLedgerSchemas";

export const StructuredSourceFieldRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: NonEmptyStructuredString,
  workspaceId: NonEmptyStructuredString,
  brainKey: NonEmptyStructuredString,
  providerKey: NonEmptyStructuredString,
  entityKind: NonEmptyStructuredString,
  providerEntityId: NonEmptyStructuredString,
  structuredEntityKey: StructuredEntityKey,
  structuredRevisionKey: StructuredRevisionKey,
  structuredObservationKey: StructuredObservationKey,
  structuredRouteKey: StructuredRouteKey,
  structuredFieldKey: StructuredFieldKey,
  providerRevision: NonEmptyStructuredString,
  observationOrder: StructuredNonNegativeInteger,
  incarnation: StructuredPositiveInteger,
  fieldPath: NonEmptyStructuredString,
  valueType: StructuredValueType,
  value: StructuredValue,
  valueHash: StructuredDigest,
  stringValue: Schema.NullOr(Schema.String),
  numberValue: Schema.NullOr(Schema.Number),
  booleanValue: Schema.NullOr(Schema.Boolean),
  timestampValue: Schema.NullOr(StructuredNonNegativeInteger),
  authority: StructuredAuthority,
  sourceModifiedAt: StructuredNonNegativeInteger,
  observedAt: StructuredNonNegativeInteger,
  locator: NonEmptyStructuredString,
  eligibilityManifest: StructuredEligibilityManifest,
  recordedAt: StructuredNonNegativeInteger,
});

const brainValuePrefix = [
  "organizationKey",
  "workspaceId",
  "brainKey",
  "entityKind",
  "fieldPath",
] as const;

export default Table.make(() => StructuredSourceFieldRow)
  .index("by_organization", ["organizationKey"])
  .index("by_organization_field_key", ["organizationKey", "structuredFieldKey"])
  .index("by_revision_observation_field_path", [
    "organizationKey",
    "structuredRevisionKey",
    "structuredObservationKey",
    "fieldPath",
  ])
  .index("by_brain_entity_field_string_value_entity", [
    ...brainValuePrefix,
    "stringValue",
    "structuredEntityKey",
    "structuredRevisionKey",
  ])
  .index("by_brain_entity_field_number_value_entity", [
    ...brainValuePrefix,
    "numberValue",
    "structuredEntityKey",
    "structuredRevisionKey",
  ])
  .index("by_brain_entity_field_boolean_value_entity", [
    ...brainValuePrefix,
    "booleanValue",
    "structuredEntityKey",
    "structuredRevisionKey",
  ])
  .index("by_brain_entity_field_timestamp_value_entity", [
    ...brainValuePrefix,
    "timestampValue",
    "structuredEntityKey",
    "structuredRevisionKey",
  ]);
