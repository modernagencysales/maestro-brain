import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export const ChannelDeliveryMode = Schema.Literal(
  "requester_private",
  "capture_only",
);

export const ChannelDeliveryPolicyRow = Schema.Struct({
  organizationKey: Schema.String,
  channelKey: Schema.String,
  deliveryGeneration: Schema.Number,
  active: Schema.Boolean,
  mode: ChannelDeliveryMode,
  createdByRole: Schema.Literal("admin", "owner"),
  createdAt: Schema.Number,
});

export type ChannelDeliveryPolicyRowValue =
  typeof ChannelDeliveryPolicyRow.Type;

export default Table.make(() => ChannelDeliveryPolicyRow)
  .index("by_channel_generation", ["channelKey", "deliveryGeneration"])
  .index("by_channel_active", ["channelKey", "active"])
  .index("by_organization_mode", ["organizationKey", "mode"]);
