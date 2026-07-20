import { describe, expect, it } from "vitest";

import {
  buildChannelPolicyDialogState,
  buildChannelPolicyRows,
} from "./channel-policy-view-model";

const channels = [
  {
    channelKey: "slack_org:C_general",
    name: "general",
    isJoined: true,
    isSlackConnect: false,
    routingMode: "needs_policy" as const,
  },
  {
    channelKey: "slack_org:C_shared",
    name: "shared-client",
    isJoined: true,
    isSlackConnect: true,
    routingMode: "capture_only" as const,
  },
];

describe("channel policy view model", () => {
  it("locks Slack Connect delivery to capture-only and keeps joined channels selectable", () => {
    expect(buildChannelPolicyRows(channels)).toEqual([
      {
        channelKey: "slack_org:C_general",
        label: "#general",
        selectable: true,
        routingLabel: "Needs policy",
        deliveryLabel: "Requester-private answers allowed",
        deliveryLocked: false,
      },
      {
        channelKey: "slack_org:C_shared",
        label: "#shared-client",
        selectable: true,
        routingLabel: "Capture-only",
        deliveryLabel: "Slack Connect capture-only",
        deliveryLocked: true,
      },
    ]);
  });

  it("surfaces launch-envelope caps before bulk submit", () => {
    expect(
      buildChannelPolicyDialogState({
        selectedChannelCount: 101,
        clientBrainCount: 26,
      }),
    ).toEqual({
      canSubmit: false,
      channelCapacityLabel: "101 of 100 active channels selected",
      targetCapacityLabel: "26 of 25 Client Brain targets available",
      controls: buildChannelPolicyDialogState({
        selectedChannelCount: 0,
        clientBrainCount: 0,
      }).controls,
      warnings: [
        "Reduce active Slack channels to 100 or fewer.",
        "Reduce Client Brain targets to 25 or fewer.",
      ],
    });
  });

  it("builds explicit bulk policy controls for selected channels", () => {
    expect(
      buildChannelPolicyDialogState({
        selectedChannelCount: 2,
        clientBrainCount: 2,
      }).controls,
    ).toEqual({
      routingModes: [
        { value: "direct", label: "Direct to one Client Brain" },
        { value: "classify", label: "Classify across allowed Client Brains" },
        { value: "capture_only", label: "Capture-only" },
      ],
      deliveryModes: [
        {
          value: "requester_private",
          label: "Requester-private internal answers",
        },
        { value: "capture_only", label: "Capture-only delivery" },
      ],
      targetBrainHelper:
        "Choose exactly one target for Direct, one or more for Classify, and none for Capture-only.",
    });
  });
});
