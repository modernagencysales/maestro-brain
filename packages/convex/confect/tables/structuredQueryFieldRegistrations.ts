import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import {
  StructuredFieldIndex,
  StructuredQueryOperator,
} from "../brain/structuredQueryPlanner";
import {
  NonEmptyStructuredString,
  StructuredNonNegativeInteger,
  StructuredPositiveInteger,
  StructuredValueType,
} from "../integrations/structuredLedgerSchemas";

export const StructuredQueryFieldRegistrationRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: NonEmptyStructuredString,
  workspaceId: NonEmptyStructuredString,
  brainKey: NonEmptyStructuredString,
  registrationKey: Schema.String.pipe(Schema.pattern(/^sqreg_[a-f0-9]{64}$/)),
  entityKind: NonEmptyStructuredString,
  fieldPath: NonEmptyStructuredString,
  valueType: StructuredValueType,
  operators: Schema.Array(StructuredQueryOperator).pipe(
    Schema.minItems(1),
    Schema.maxItems(4),
  ),
  physicalIndex: StructuredFieldIndex,
  fieldMappingPolicyKey: NonEmptyStructuredString,
  fieldMappingPolicyGeneration: StructuredPositiveInteger,
  state: Schema.Literal("active", "retired"),
  createdAt: StructuredNonNegativeInteger,
  updatedAt: StructuredNonNegativeInteger,
});

export default Table.make(() => StructuredQueryFieldRegistrationRow)
  .index("by_registration_key", ["organizationKey", "registrationKey"])
  .index("by_brain_state_entity_field", [
    "organizationKey",
    "workspaceId",
    "brainKey",
    "state",
    "entityKind",
    "fieldPath",
  ]);
