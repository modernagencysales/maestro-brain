import { templateConfectRefs } from "@maestro-template/convex/refs";
import { describe, expect, it } from "vitest";
import { buildChannelPolicyAdapterState } from "./connections-adapter";
import {
  buildChannelPolicyDialogState,
  buildChannelPolicyRows,
  buildChannelPolicySubmitRequest,
} from "./channel-policy-view-model";
const generatedRefsWithPendingSlack =
  templateConfectRefs.public as typeof templateConfectRefs.public & {
    readonly slack?: {
      readonly channelPolicies?: {
        readonly getChannelPolicyReadModel: {
          readonly functionNamespace: string;
          readonly functionSpec: {
            readonly functionProvenance: unknown;
            readonly functionVisibility: string;
            readonly name: string;
            readonly runtimeAndFunctionType: { readonly functionType: string };
          };
        };
        readonly bulkSetChannelPolicies: {
          readonly functionNamespace: string;
          readonly functionSpec: {
            readonly functionProvenance: unknown;
            readonly functionVisibility: string;
            readonly name: string;
            readonly runtimeAndFunctionType: { readonly functionType: string };
          };
        };
      };
    };
  };
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
  it("uses generated channel policy refs once centralized codegen materializes them", () => {
    const refs = generatedRefsWithPendingSlack.slack?.channelPolicies;
    if (!refs)
      return expect(generatedRefsWithPendingSlack.slack).toBeUndefined();
    expect(refs.getChannelPolicyReadModel.functionSpec).toMatchObject({
      name: "getChannelPolicyReadModel",
      functionVisibility: "public",
      runtimeAndFunctionType: { functionType: "query" },
    });
    expect(refs.bulkSetChannelPolicies.functionSpec).toMatchObject({
      name: "bulkSetChannelPolicies",
      functionVisibility: "public",
      runtimeAndFunctionType: { functionType: "mutation" },
    });
    expect(refs.getChannelPolicyReadModel.functionNamespace).toBe(
      "slack/channelPolicies",
    );
  });
  it("builds selectable Slack Connect rows, launch caps, controls, and submit payloads", () => {
    expect(
      buildChannelPolicyRows(channels, ["slack_org:C_general"]),
    ).toMatchObject([
      {
        selected: true,
        deliveryLocked: false,
        deliveryLabel: "Requester-private answers allowed",
      },
      {
        selected: false,
        deliveryLocked: true,
        deliveryLabel: "Slack Connect capture-only",
      },
    ]);
    expect(
      buildChannelPolicyDialogState({
        selectedChannelCount: 101,
        clientBrainCount: 26,
        routingMode: "direct",
        targetBrainKeys: ["brain_alpha"],
        deliveryMode: "requester_private",
      }),
    ).toMatchObject({
      canSubmit: false,
      warnings: [
        "Reduce active Slack channels to 100 or fewer.",
        "Reduce Client Brain targets to 25 or fewer.",
      ],
    });
    expect(
      buildChannelPolicyDialogState({
        selectedChannelCount: 2,
        clientBrainCount: 2,
        routingMode: "direct",
        targetBrainKeys: ["brain_alpha"],
        deliveryMode: "requester_private",
      }).controls.routingModes,
    ).toHaveLength(3);
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
      }).changes,
    ).toEqual([
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
    ]);
  });
  it("derives joined-channel policy state from the current authorized tenant", () => {
    expect(
      buildChannelPolicyAdapterState({
        activeWorkspace: { organizationId: "org_live", status: "active" },
        channels: [
          {
            organizationKey: "org_live",
            channelKey: "slack_live:C_general",
            name: "general",
            membershipStatus: "joined_active",
            isShared: false,
            isExtShared: false,
            connectionGeneration: 7,
            accessGeneration: 3,
            activeRoutingPolicy: {
              policyEpoch: 2,
              statusAfterApply: "streaming",
            },
            activeDeliveryPolicy: { deliveryGeneration: 4 },
          },
          {
            organizationKey: "org_live",
            channelKey: "slack_live:C_random",
            name: "random",
            membershipStatus: "discovered_not_joined",
            isShared: false,
            isExtShared: false,
            connectionGeneration: 7,
            accessGeneration: 3,
          },
          {
            organizationKey: "org_other",
            channelKey: "slack_other:C_general",
            name: "other",
            membershipStatus: "joined_active",
            isShared: false,
            isExtShared: false,
            connectionGeneration: 9,
            accessGeneration: 1,
          },
        ],
        clientBrains: [
          {
            organizationKey: "org_live",
            brainKey: "brain_live",
            status: "active",
            kind: "client",
          },
          {
            organizationKey: "org_other",
            brainKey: "brain_other",
            status: "active",
            kind: "client",
          },
        ],
      }),
    ).toEqual({
      organizationKey: "org_live",
      expectedConnectionGeneration: 7,
      expectedChannelAccessGeneration: 3,
      selectedChannelCount: 1,
      clientBrainCount: 1,
      defaultTargetBrainKeys: ["brain_live"],
      channels: [
        {
          channelKey: "slack_live:C_general",
          name: "general",
          isJoined: true,
          isSlackConnect: false,
          routingMode: "streaming",
          routingPolicyEpoch: 2,
          deliveryGeneration: 4,
        },
      ],
    });
  });
});
