import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import {
  NonEmptyStructuredString,
  StructuredDigest,
  StructuredEligibilityManifest,
  StructuredEntityKey,
  StructuredLedgerClassification,
  StructuredNonNegativeInteger,
  StructuredObservationKey,
  StructuredPositiveInteger,
  StructuredRevisionKey,
  StructuredRouteKey,
} from "../integrations/structuredLedgerSchemas";

export const StructuredSourceObservationRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: NonEmptyStructuredString,
  workspaceId: NonEmptyStructuredString,
  brainKey: NonEmptyStructuredString,
  providerKey: NonEmptyStructuredString,
  entityKind: NonEmptyStructuredString,
  providerEntityId: NonEmptyStructuredString,
  structuredEntityKey: StructuredEntityKey,
  structuredObservationKey: StructuredObservationKey,
  structuredRouteKey: StructuredRouteKey,
  structuredRevisionKey: Schema.NullOr(StructuredRevisionKey),
  providerRevision: NonEmptyStructuredString,
  observationOrder: StructuredNonNegativeInteger,
  connectorScopeKey: NonEmptyStructuredString,
  connectionKey: NonEmptyStructuredString,
  connectionGeneration: StructuredPositiveInteger,
  allowlistGeneration: StructuredPositiveInteger,
  fieldMappingPolicyKey: NonEmptyStructuredString,
  fieldMappingPolicyGeneration: StructuredPositiveInteger,
  fieldManifestHash: StructuredDigest,
  eligibilityManifestHash: StructuredDigest,
  eligibilityManifest: StructuredEligibilityManifest,
  sourceModifiedAt: StructuredNonNegativeInteger,
  observedAt: StructuredNonNegativeInteger,
  locator: NonEmptyStructuredString,
  tombstone: Schema.Boolean,
  classification: StructuredLedgerClassification,
  incarnation: StructuredPositiveInteger,
  fieldCount: StructuredNonNegativeInteger,
  recordedAt: StructuredNonNegativeInteger,
});

export default Table.make(() => StructuredSourceObservationRow)
  .index("by_organization", ["organizationKey"])
  .index("by_organization_observation_key", [
    "organizationKey",
    "structuredObservationKey",
  ])
  .index("by_route_observation_order", [
    "organizationKey",
    "structuredRouteKey",
    "observationOrder",
  ])
  .index("by_entity_observed", [
    "organizationKey",
    "structuredEntityKey",
    "observedAt",
  ]);
