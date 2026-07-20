import { describe, expect, it } from "vitest";

import {
  buildChannelPolicyDialogState,
  buildChannelPolicyRows,
  buildChannelPolicySubmitRequest,
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
    routingPolicyEpoch: 3,
    deliveryGeneration: 5,
  },
];

describe("channel policy view model", () => {
  it("locks Slack Connect delivery to capture-only and keeps joined channels selectable", () => {
    expect(buildChannelPolicyRows(channels, ["slack_org:C_general"])).toEqual([
      {
        channelKey: "slack_org:C_general",
        label: "#general",
        selectable: true,
        selected: true,
        routingLabel: "Needs policy",
        deliveryLabel: "Requester-private answers allowed",
        deliveryLocked: false,
      },
      {
        channelKey: "slack_org:C_shared",
        label: "#shared-client",
        selectable: true,
        selected: false,
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
        routingMode: "direct",
        targetBrainKeys: ["brain_alpha"],
        deliveryMode: "requester_private",
      }),
    ).toEqual({
      canSubmit: false,
      channelCapacityLabel: "101 of 100 active channels selected",
      targetCapacityLabel: "26 of 25 Client Brain targets available",
      controls: buildChannelPolicyDialogState({
        selectedChannelCount: 0,
        clientBrainCount: 0,
        routingMode: "direct",
        targetBrainKeys: ["brain_alpha"],
        deliveryMode: "requester_private",
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
        routingMode: "direct",
        targetBrainKeys: ["brain_alpha"],
        deliveryMode: "requester_private",
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

  it("builds a bulk mutation request from selected joined channels and policy inputs", () => {
    expect(
      buildChannelPolicySubmitRequest({
        organizationKey: "org_acme",
        expectedConnectionGeneration: 4,
        expectedChannelAccessGeneration: 2,
        channels,
        selectedChannelKeys: ["slack_org:C_general", "slack_org:C_shared"],
        routingMode: "classify",
        targetBrainKeys: ["brain_alpha", "brain_beta"],
        deliveryMode: "requester_private",
      }),
    ).toEqual({
      organizationKey: "org_acme",
      expectedConnectionGeneration: 4,
      expectedChannelAccessGeneration: 2,
      changes: [
        {
          channelKey: "slack_org:C_general",
          expectedRoutingPolicyEpoch: undefined,
          expectedDeliveryGeneration: undefined,
          routing: {
            mode: "classify",
            targetBrainKeys: ["brain_alpha", "brain_beta"],
          },
          delivery: { mode: "requester_private" },
        },
        {
          channelKey: "slack_org:C_shared",
          expectedRoutingPolicyEpoch: 3,
          expectedDeliveryGeneration: 5,
          routing: {
            mode: "classify",
            targetBrainKeys: ["brain_alpha", "brain_beta"],
          },
          delivery: { mode: "capture_only" },
        },
      ],
    });
  });
});
