import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  ContentHash,
  NonNegativeInteger,
  PositiveInteger,
} from "../brain/retrievalSchemas";

export const BrainRequiredScopeIntentRow = Schema.Struct({
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
  requiredScopeIntentKey: Schema.String.pipe(
    Schema.pattern(/^brsi_[a-f0-9]{64}$/),
  ),
  intentGeneration: PositiveInteger,
  controllingConfigurationDigest: ContentHash,
  state: Schema.Literal("required", "decommissioned"),
  decommissionGeneration: Schema.NullOr(PositiveInteger),
  activatedAt: NonNegativeInteger,
  decommissionedAt: Schema.NullOr(NonNegativeInteger),
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => BrainRequiredScopeIntentRow)
  .index("by_required_scope_intent_key", ["requiredScopeIntentKey"])
  .index("by_workspace_brain_state", ["workspaceId", "brainKey", "state"])
  .index("by_scope_intent_generation", [
    "connectorScopeKey",
    "intentGeneration",
  ]);
