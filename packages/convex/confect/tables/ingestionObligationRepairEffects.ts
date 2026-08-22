import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import { NonNegativeInteger } from "../brain/retrievalSchemas";

export const IngestionObligationRepairEffectRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  scopeKey: Schema.String,
  repairEffectKey: Schema.String.pipe(Schema.pattern(/^irep_[a-f0-9]{64}$/)),
  ingestionObligationKey: Schema.String.pipe(
    Schema.pattern(/^iobl_[a-f0-9]{64}$/),
  ),
  failureVersion: NonNegativeInteger,
  mode: Schema.Literal("retry", "attributed_repair"),
  state: Schema.Literal("queued", "running", "succeeded", "failed"),
  reason: Schema.String,
  createdAt: NonNegativeInteger,
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => IngestionObligationRepairEffectRow)
  .index("by_repair_effect_key", ["repairEffectKey"])
  .index("by_obligation_failure_version", [
    "ingestionObligationKey",
    "failureVersion",
  ])
  .index("by_state_updated", ["state", "updatedAt"])
  .index("by_organization_workspace_brain_state_updated", [
    "organizationKey",
    "workspaceId",
    "brainKey",
    "state",
    "updatedAt",
  ]);
