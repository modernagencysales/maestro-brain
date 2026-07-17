import { Table } from "@confect/server";
import * as Schema from "effect/Schema";

export const SourceChannelMembershipStatus = Schema.Literal(
  "discovered_not_joined",
  "joined_needs_policy",
  "joined_active",
  "access_lost",
  "archived",
);

export const SourceChannelRow = Schema.Struct({
  organizationKey: Schema.String,
  connectionKey: Schema.String,
  connectionGeneration: Schema.Number,
  channelKey: Schema.String,
  externalChannelId: Schema.String,
  name: Schema.String,
  normalizedName: Schema.String,
  isMember: Schema.Boolean,
  isShared: Schema.Boolean,
  isExtShared: Schema.Boolean,
  isArchived: Schema.Boolean,
  membershipStatus: SourceChannelMembershipStatus,
  accessGeneration: Schema.Number,
  firstDiscoveredAt: Schema.Number,
  lastSeenAt: Schema.Number,
  updatedAt: Schema.Number,
});

export type SourceChannelRowValue = typeof SourceChannelRow.Type;

export default Table.make(() => SourceChannelRow)
  .index("by_connection_generation", ["connectionKey", "connectionGeneration"])
  .index("by_channel_key", ["channelKey"])
  .index("by_external_generation", [
    "connectionKey",
    "connectionGeneration",
    "externalChannelId",
  ])
  .index("by_organization", ["organizationKey"]);
