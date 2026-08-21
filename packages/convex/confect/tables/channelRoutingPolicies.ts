import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export const ChannelRoutingMode = Schema.Literal(
  "direct",
  "classify",
  "capture_only",
);

export const ChannelRoutingStatus = Schema.Literal(
  "needs_policy",
  "streaming",
  "capture_only",
  "access_lost",
  "error",
);

export const PendingSourceInterval = Schema.Struct({
  firstObservedAt: Schema.Number,
  status: Schema.Literal("pending", "closed"),
});

export const ChannelRoutingPolicyRow = Schema.Struct({
  organizationKey: Schema.String,
  connectionKey: Schema.String,
  connectionGeneration: Schema.Number,
  channelKey: Schema.String,
  policyEpoch: Schema.Number,
  active: Schema.Boolean,
  mode: ChannelRoutingMode,
  targetBrainKeys: Schema.Array(Schema.String),
  historicalBackfillStartAt: Schema.optional(Schema.Number),
  statusAfterApply: ChannelRoutingStatus,
  pendingSourceInterval: Schema.optional(Schema.NullOr(PendingSourceInterval)),
  createdByRole: Schema.Literal("admin", "owner"),
  createdAt: Schema.Number,
});

export type ChannelRoutingPolicyRowValue = typeof ChannelRoutingPolicyRow.Type;

export default Table.make(() => ChannelRoutingPolicyRow)
  .index("by_channel_epoch", ["channelKey", "policyEpoch"])
  .index("by_channel_active", ["channelKey", "active"])
  .index("by_organization_created", ["organizationKey", "createdAt"])
  .index("by_organization_mode", ["organizationKey", "mode"])
  .index("by_connection_generation", ["connectionKey", "connectionGeneration"]);
