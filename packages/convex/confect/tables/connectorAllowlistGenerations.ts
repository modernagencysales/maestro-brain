import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import {
  ContentHash,
  NonNegativeInteger,
  PositiveInteger,
} from "../brain/retrievalSchemas";

const NonEmptyString = Schema.String.pipe(
  Schema.minLength(1),
  Schema.maxLength(2_048),
);

export const ConnectorAllowlistGenerationRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: NonEmptyString,
  connectorScopeKey: NonEmptyString,
  allowlistGenerationKey: Schema.String.pipe(
    Schema.pattern(/^calg_[a-f0-9]{64}$/),
  ),
  connectionKey: NonEmptyString,
  connectionGeneration: PositiveInteger,
  allowlistGeneration: PositiveInteger,
  configurationDigest: ContentHash,
  memberCount: NonNegativeInteger,
  state: Schema.Literal("current", "superseded", "revoked"),
  createdAt: NonNegativeInteger,
  supersededAt: Schema.NullOr(NonNegativeInteger),
});

export default Table.make(() => ConnectorAllowlistGenerationRow)
  .index("by_allowlist_generation_key", ["allowlistGenerationKey"])
  .index("by_scope_generation", ["connectorScopeKey", "allowlistGeneration"])
  .index("by_scope_state", ["connectorScopeKey", "state"]);
