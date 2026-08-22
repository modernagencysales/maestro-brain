import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { NonNegativeInteger, PositiveInteger } from "../brain/retrievalSchemas";

const NonEmptyString = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(2_048),
);

export const ConnectorScopeRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: NonEmptyString,
  connectorScopeKey: NonEmptyString,
  providerKind: Schema.Literal(
    "slack",
    "transcript",
    "google_drive",
    "structured",
  ),
  providerContainerKey: NonEmptyString,
  connectionKey: NonEmptyString,
  currentConnectionGeneration: PositiveInteger,
  currentAllowlistGeneration: PositiveInteger,
  scopeGeneration: PositiveInteger,
  state: Schema.Literal("active", "revoked"),
  createdAt: NonNegativeInteger,
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => ConnectorScopeRow)
  .index("by_connector_scope_key", ["connectorScopeKey"])
  .index("by_organization_provider_container", [
    "organizationKey",
    "providerKind",
    "providerContainerKey",
  ])
  .index("by_connection_scope", ["connectionKey", "connectorScopeKey"]);
