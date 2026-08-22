import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import { NonNegativeInteger, PositiveInteger } from "../brain/retrievalSchemas";

export const BrainReadMode = Schema.Literal("compatibility", "disabled");

export const BrainReadModeRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  mode: BrainReadMode,
  modeGeneration: PositiveInteger,
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => BrainReadModeRow).index("by_workspace_brain", [
  "workspaceId",
  "brainKey",
]);
