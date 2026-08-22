import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import { NonNegativeInteger } from "../brain/retrievalSchemas";

export const BrainPublicationPauseRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  scopeKey: Schema.String,
  pauseKey: Schema.String.pipe(Schema.pattern(/^bpps_[a-f0-9]{64}$/)),
  pauseEpoch: NonNegativeInteger,
  state: Schema.Literal("running", "paused"),
  reason: Schema.NullOr(Schema.String),
  pausedAt: Schema.NullOr(NonNegativeInteger),
  resumedAt: Schema.NullOr(NonNegativeInteger),
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => BrainPublicationPauseRow)
  .index("by_pause_key", ["pauseKey"])
  .index("by_workspace_brain_scope", ["workspaceId", "brainKey", "scopeKey"]);
