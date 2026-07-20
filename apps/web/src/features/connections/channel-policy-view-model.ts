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
  readonly selected: boolean;
  readonly routingLabel: string;
  readonly deliveryLabel: string;
  readonly deliveryLocked: boolean;
};

export type ChannelPolicyRoutingInput = "direct" | "classify" | "capture_only";
export type ChannelPolicyDeliveryInput = "requester_private" | "capture_only";

export type ChannelPolicySubmitRequest = {
  readonly organizationKey: string;
  readonly expectedConnectionGeneration: number;
  readonly expectedChannelAccessGeneration: number;
  readonly changes: readonly {
    readonly channelKey: string;
    readonly routing: {
      readonly mode: ChannelPolicyRoutingInput;
      readonly targetBrainKeys: readonly string[];
    };
    readonly delivery: { readonly mode: ChannelPolicyDeliveryInput };
  }[];
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
  selectedChannelKeys: readonly string[] = [],
): readonly ChannelPolicyRow[] => {
  const selected = new Set(selectedChannelKeys);
  return channels.map((channel) => ({
    channelKey: channel.channelKey,
    label: `#${channel.name}`,
    selectable: channel.isJoined,
    selected: selected.has(channel.channelKey),
    routingLabel: routingLabels[channel.routingMode],
    deliveryLabel: channel.isSlackConnect
      ? "Slack Connect capture-only"
      : "Requester-private answers allowed",
    deliveryLocked: channel.isSlackConnect,
  }));
};

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
  readonly routingMode?: ChannelPolicyRoutingInput;
  readonly targetBrainKeys?: readonly string[];
  readonly deliveryMode?: ChannelPolicyDeliveryInput;
}) => {
  const warnings = [
    ...(input.selectedChannelCount > 100
      ? ["Reduce active Slack channels to 100 or fewer."]
      : []),
    ...(input.clientBrainCount > 25
      ? ["Reduce Client Brain targets to 25 or fewer."]
      : []),
    ...(input.selectedChannelCount === 0
      ? ["Select at least one joined Slack channel."]
      : []),
    ...(input.routingMode === "direct" && input.targetBrainKeys?.length !== 1
      ? ["Direct routing requires exactly one Client Brain target."]
      : []),
    ...(input.routingMode === "classify" && input.targetBrainKeys?.length === 0
      ? ["Classify routing requires at least one Client Brain target."]
      : []),
    ...(input.routingMode === "capture_only" &&
    (input.targetBrainKeys?.length ?? 0) > 0
      ? ["Capture-only routing cannot include Client Brain targets."]
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

export const buildChannelPolicySubmitRequest = (input: {
  readonly organizationKey: string;
  readonly expectedConnectionGeneration: number;
  readonly expectedChannelAccessGeneration: number;
  readonly channels: readonly ChannelPolicyChannel[];
  readonly selectedChannelKeys: readonly string[];
  readonly routingMode: ChannelPolicyRoutingInput;
  readonly targetBrainKeys: readonly string[];
  readonly deliveryMode: ChannelPolicyDeliveryInput;
}): ChannelPolicySubmitRequest => {
  const channelsByKey = new Map(
    input.channels.map((channel) => [channel.channelKey, channel]),
  );
  return {
    organizationKey: input.organizationKey,
    expectedConnectionGeneration: input.expectedConnectionGeneration,
    expectedChannelAccessGeneration: input.expectedChannelAccessGeneration,
    changes: input.selectedChannelKeys.flatMap((channelKey) => {
      const channel = channelsByKey.get(channelKey);
      if (!channel?.isJoined) return [];
      return [
        {
          channelKey,
          routing: {
            mode: input.routingMode,
            targetBrainKeys: [...input.targetBrainKeys],
          },
          delivery: {
            mode: channel.isSlackConnect ? "capture_only" : input.deliveryMode,
          },
        },
      ];
    }),
  };
};
