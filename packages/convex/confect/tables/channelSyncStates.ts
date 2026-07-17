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
  createdAt: Schema.Number,
  updatedAt: Schema.Number,
});

export type ChannelSyncStateRowValue = typeof ChannelSyncStateRow.Type;

export default Table.make(() => ChannelSyncStateRow)
  .index("by_channel_lane", ["channelKey", "lane"])
  .index("by_connection_lane", ["connectionKey", "lane"])
  .index("by_status", ["status"]);
