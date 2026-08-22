import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import {
  NonEmptyStructuredString,
  StructuredDigest,
  StructuredEligibilityManifest,
  StructuredEntityKey,
  StructuredNonNegativeInteger,
  StructuredObservationKey,
  StructuredPositiveInteger,
  StructuredRevisionKey,
  StructuredRouteKey,
} from "../integrations/structuredLedgerSchemas";

export const StructuredSourceRouteRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: NonEmptyStructuredString,
  workspaceId: NonEmptyStructuredString,
  brainKey: NonEmptyStructuredString,
  connectorScopeKey: NonEmptyStructuredString,
  structuredRouteKey: StructuredRouteKey,
  structuredEntityKey: StructuredEntityKey,
  routeState: Schema.Literal("active", "tombstoned"),
  currentRevisionKey: StructuredRevisionKey,
  currentObservationKey: StructuredObservationKey,
  currentObservationOrder: StructuredNonNegativeInteger,
  incarnation: StructuredPositiveInteger,
  eligibilityManifestHash: StructuredDigest,
  eligibilityManifest: StructuredEligibilityManifest,
  updatedAt: StructuredNonNegativeInteger,
});

export default Table.make(() => StructuredSourceRouteRow)
  .index("by_organization", ["organizationKey"])
  .index("by_organization_route_key", ["organizationKey", "structuredRouteKey"])
  .index("by_brain_scope_entity", [
    "organizationKey",
    "workspaceId",
    "brainKey",
    "connectorScopeKey",
    "structuredEntityKey",
  ])
  .index("by_brain_entity", [
    "organizationKey",
    "workspaceId",
    "brainKey",
    "structuredEntityKey",
  ]);
