import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import { NonNegativeInteger, PositiveInteger } from "../brain/retrievalSchemas";

const NonNegativeNumber = Schema.Number.pipe(Schema.greaterThanOrEqualTo(0));

export const ConnectorIncrementalCursorRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  corpusKey: Schema.Literal("slack", "transcripts"),
  providerKind: Schema.Literal("slack", "transcript"),
  connectorScopeKey: Schema.String,
  connectionKey: Schema.String,
  connectionGeneration: PositiveInteger,
  allowlistGeneration: PositiveInteger,
  cursorKey: Schema.String.pipe(Schema.pattern(/^ccur_[a-f0-9]{64}$/)),
  providerCursor: Schema.NullOr(Schema.String),
  cursorGeneration: PositiveInteger,
  activeEnvelopeKey: Schema.NullOr(
    Schema.String.pipe(Schema.pattern(/^cenv_[a-f0-9]{64}$/)),
  ),
  lastProviderHighWater: Schema.NullOr(Schema.String),
  ledgerHighWater: NonNegativeNumber,
  createdAt: NonNegativeInteger,
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => ConnectorIncrementalCursorRow)
  .index("by_cursor_key", ["cursorKey"])
  .index("by_scope_tuple", [
    "connectorScopeKey",
    "connectionGeneration",
    "allowlistGeneration",
  ])
  .index("by_connection_scope", ["connectionKey", "connectorScopeKey"]);
