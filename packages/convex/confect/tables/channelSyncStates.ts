import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export const ChannelSyncLane = Schema.Literal(
  "live",
  "recent",
  "deep",
  "reconciliation",
);
export const ChannelSyncStatus = Schema.Literal(
  "not_started",
  "idle",
  "queued",
  "running",
  "complete",
  "waiting_rate_limit",
  "retry_wait",
  "access_lost",
  "dead_letter",
);

const OptionalNullableNumber = Schema.optional(Schema.NullOr(Schema.Number));
const OptionalNullableString = Schema.optional(Schema.NullOr(Schema.String));

export const ChannelReplacementAudit = Schema.Struct({
  connectionKey: Schema.String,
  connectionGeneration: Schema.Number,
  reason: Schema.String,
  recordedAt: Schema.Number,
});

export const ChannelSyncStateRow = Schema.Struct({
  organizationKey: Schema.String,
  connectionKey: Schema.String,
  connectionGeneration: Schema.Number,
  channelKey: Schema.String,
  lane: ChannelSyncLane,
  status: ChannelSyncStatus,
  cursor: OptionalNullableString,
  leaseId: OptionalNullableString,
  leaseExpiresAt: OptionalNullableNumber,
  lastProgressAt: OptionalNullableNumber,
  replacementAudit: Schema.optional(Schema.NullOr(ChannelReplacementAudit)),
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

export type ChannelSyncStateRowValue = typeof ChannelSyncStateRow.Type;

export default Table.make(() => ChannelSyncStateRow)
  .index("by_channel", ["channelKey", "lane"])
  .index("by_live_lag", ["organizationKey", "status", "lastProgressAt"])
  .index("by_recent_next_retry", [
    "organizationKey",
    "status",
    "leaseExpiresAt",
  ])
  .index("by_deep_next_retry", ["organizationKey", "status", "leaseExpiresAt"])
  .index("by_access_state", ["connectionKey", "lane", "status"]);
