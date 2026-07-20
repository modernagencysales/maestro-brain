export type ChannelPolicyRoutingMode =
  "needs_policy" | "streaming" | "capture_only" | "access_lost" | "error";

export type ChannelPolicyChannel = {
  readonly channelKey: string;
  readonly name: string;
  readonly isJoined: boolean;
  readonly isSlackConnect: boolean;
  readonly routingMode: ChannelPolicyRoutingMode;
};

export type ChannelPolicyRow = {
  readonly channelKey: string;
  readonly label: string;
  readonly selectable: boolean;
  readonly routingLabel: string;
  readonly deliveryLabel: string;
  readonly deliveryLocked: boolean;
};

const routingLabels: Record<ChannelPolicyRoutingMode, string> = {
  needs_policy: "Needs policy",
  streaming: "Streaming",
  capture_only: "Capture-only",
  access_lost: "Access lost",
  error: "Error",
};

export const buildChannelPolicyRows = (
  channels: readonly ChannelPolicyChannel[],
): readonly ChannelPolicyRow[] =>
  channels.map((channel) => ({
    channelKey: channel.channelKey,
    label: `#${channel.name}`,
    selectable: channel.isJoined,
    routingLabel: routingLabels[channel.routingMode],
    deliveryLabel: channel.isSlackConnect
      ? "Slack Connect capture-only"
      : "Requester-private answers allowed",
    deliveryLocked: channel.isSlackConnect,
  }));

const routingModeControls = [
  { value: "direct", label: "Direct to one Client Brain" },
  { value: "classify", label: "Classify across allowed Client Brains" },
  { value: "capture_only", label: "Capture-only" },
] as const;

const deliveryModeControls = [
  { value: "requester_private", label: "Requester-private internal answers" },
  { value: "capture_only", label: "Capture-only delivery" },
] as const;

export const buildChannelPolicyDialogState = (input: {
  readonly selectedChannelCount: number;
  readonly clientBrainCount: number;
}) => {
  const warnings = [
    ...(input.selectedChannelCount > 100
      ? ["Reduce active Slack channels to 100 or fewer."]
      : []),
    ...(input.clientBrainCount > 25
      ? ["Reduce Client Brain targets to 25 or fewer."]
      : []),
  ];
  return {
    canSubmit: warnings.length === 0,
    channelCapacityLabel: `${input.selectedChannelCount} of 100 active channels selected`,
    targetCapacityLabel: `${input.clientBrainCount} of 25 Client Brain targets available`,
    controls: {
      routingModes: routingModeControls,
      deliveryModes: deliveryModeControls,
      targetBrainHelper:
        "Choose exactly one target for Direct, one or more for Classify, and none for Capture-only.",
    },
    warnings,
  };
};
