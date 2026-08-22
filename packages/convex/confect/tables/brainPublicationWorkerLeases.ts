import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import { NonNegativeInteger } from "../brain/retrievalSchemas";

export const BrainPublicationWorkerLeaseRow = Schema.Struct({
  schemaVersion: Schema.Literal(1),
  organizationKey: Schema.String,
  workspaceId: Id("workspaces"),
  brainKey: Schema.String,
  scopeKey: Schema.String,
  pauseKey: Schema.String.pipe(Schema.pattern(/^bpps_[a-f0-9]{64}$/)),
  leaseKey: Schema.String.pipe(Schema.pattern(/^bpwl_[a-f0-9]{64}$/)),
  jobKey: Schema.String,
  pauseEpoch: NonNegativeInteger,
  state: Schema.Literal("active", "released", "abandoned"),
  claimedAt: NonNegativeInteger,
  expiresAt: NonNegativeInteger,
  releasedAt: Schema.NullOr(NonNegativeInteger),
  releaseReason: Schema.NullOr(
    Schema.Literal("completed", "paused", "expired", "superseded"),
  ),
  updatedAt: NonNegativeInteger,
});

export default Table.make(() => BrainPublicationWorkerLeaseRow)
  .index("by_lease_key", ["leaseKey"])
  .index("by_pause_state_epoch", ["pauseKey", "state", "pauseEpoch"])
  .index("by_organization_workspace_brain_state", [
    "organizationKey",
    "workspaceId",
    "brainKey",
    "state",
  ])
  .index("by_job_state", ["jobKey", "state"]);
