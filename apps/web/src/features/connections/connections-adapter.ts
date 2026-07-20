import type { ChannelPolicyChannel } from "./channel-policy-view-model";

export const localChannelPolicyFixture = {
  selectedChannelCount: 2,
  clientBrainCount: 2,
  channels: [
    {
      channelKey: "slack_agency:C_general",
      name: "general",
      isJoined: true,
      isSlackConnect: false,
      routingMode: "needs_policy",
    },
    {
      channelKey: "slack_agency:C_shared",
      name: "shared-client",
      isJoined: true,
      isSlackConnect: true,
      routingMode: "capture_only",
    },
  ] satisfies readonly ChannelPolicyChannel[],
};
