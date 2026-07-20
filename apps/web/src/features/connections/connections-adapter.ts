import type {
  ChannelPolicyChannel,
  ChannelPolicyRoutingMode,
} from "./channel-policy-view-model";
type ActiveWorkspaceInput = {
  readonly organizationId: string;
  readonly status: "active" | string;
};
type ChannelPolicySourceChannel = {
  readonly organizationKey: string;
  readonly channelKey: string;
  readonly name: string;
  readonly membershipStatus: string;
  readonly isShared: boolean;
  readonly isExtShared: boolean;
  readonly connectionGeneration: number;
  readonly accessGeneration: number;
  readonly activeRoutingPolicy?: {
    readonly policyEpoch: number;
    readonly statusAfterApply: ChannelPolicyRoutingMode;
  };
  readonly activeDeliveryPolicy?: { readonly deliveryGeneration: number };
};
type ChannelPolicyBrain = {
  readonly organizationKey: string;
  readonly brainKey: string;
  readonly kind: "client" | "agency" | string;
  readonly status: "active" | string;
};
export type ChannelPolicyAdapterState = {
  readonly organizationKey: string;
  readonly expectedConnectionGeneration: number;
  readonly expectedChannelAccessGeneration: number;
  readonly selectedChannelCount: number;
  readonly clientBrainCount: number;
  readonly defaultTargetBrainKeys: readonly string[];
  readonly channels: readonly ChannelPolicyChannel[];
};
const isJoined = (channel: ChannelPolicySourceChannel) =>
  channel.membershipStatus === "joined_needs_policy" ||
  channel.membershipStatus === "joined_active";
export const buildChannelPolicyAdapterState = (input: {
  readonly activeWorkspace: ActiveWorkspaceInput | null;
  readonly channels?: readonly ChannelPolicySourceChannel[];
  readonly clientBrains?: readonly ChannelPolicyBrain[];
}): ChannelPolicyAdapterState => {
  const organizationKey = input.activeWorkspace?.organizationId ?? "";
  const joinedChannels = (input.channels ?? []).filter(
    (channel) =>
      channel.organizationKey === organizationKey && isJoined(channel),
  );
  const activeClientBrains = (input.clientBrains ?? []).filter(
    (brain) =>
      brain.organizationKey === organizationKey &&
      brain.kind === "client" &&
      brain.status === "active",
  );
  return {
    organizationKey,
    expectedConnectionGeneration: joinedChannels[0]?.connectionGeneration ?? 0,
    expectedChannelAccessGeneration: joinedChannels[0]?.accessGeneration ?? 0,
    selectedChannelCount: joinedChannels.length,
    clientBrainCount: activeClientBrains.length,
    defaultTargetBrainKeys: activeClientBrains
      .slice(0, 1)
      .map((brain) => brain.brainKey),
    channels: joinedChannels.map((channel) => ({
      channelKey: channel.channelKey,
      name: channel.name,
      isJoined: true,
      isSlackConnect: channel.isShared || channel.isExtShared,
      routingMode:
        channel.activeRoutingPolicy?.statusAfterApply ?? "needs_policy",
      routingPolicyEpoch: channel.activeRoutingPolicy?.policyEpoch,
      deliveryGeneration: channel.activeDeliveryPolicy?.deliveryGeneration,
    })),
  };
};
