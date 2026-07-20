import { describe, expect, it } from "vitest";

import { bulkSetChannelPolicies } from "../confect/slack/channelPolicies.spec";
import channelDeliveryPoliciesSource from "../confect/tables/channelDeliveryPolicies";
import channelRoutingPoliciesSource from "../confect/tables/channelRoutingPolicies";
import {
  PolicyInvalid,
  buildBulkPolicyPlan,
} from "../confect/slack/channelPolicy";

const joinedChannel = {
  organizationKey: "org_acme",
  connectionKey: "slack_org_acme",
  connectionGeneration: 4,
  channelKey: "slack_org_acme:C_general",
  externalChannelId: "C_general",
  name: "general",
  normalizedName: "general",
  isMember: true,
  isShared: false,
  isExtShared: false,
  isArchived: false,
  membershipStatus: "joined_needs_policy" as const,
  accessGeneration: 2,
  firstDiscoveredAt: 1_000,
  lastSeenAt: 1_000,
  updatedAt: 1_000,
};

const connectChannel = {
  ...joinedChannel,
  channelKey: "slack_org_acme:C_shared",
  externalChannelId: "C_shared",
  name: "shared-client",
  normalizedName: "shared-client",
  isShared: true,
  isExtShared: true,
};

const brainTargets = [
  {
    brainKey: "brain_alpha",
    name: "Alpha",
    organizationKey: "org_acme",
    kind: "client" as const,
    status: "active" as const,
  },
  {
    brainKey: "brain_beta",
    name: "Beta",
    organizationKey: "org_acme",
    kind: "client" as const,
    status: "active" as const,
  },
];

const baseRequest = {
  organizationKey: "org_acme",
  actorRole: "admin" as const,
  expectedConnectionGeneration: 4,
  expectedChannelAccessGeneration: 2,
  now: 2_000,
  channels: [joinedChannel],
  existingRoutingPolicies: [],
  existingDeliveryPolicies: [],
  allowedBrainTargets: brainTargets,
  changes: [
    {
      channelKey: joinedChannel.channelKey,
      routing: {
        mode: "direct" as const,
        targetBrainKeys: ["brain_alpha"],
      },
      delivery: { mode: "requester_private" as const },
    },
  ],
};

const expectRejectedChange = (routing: {
  readonly mode: "direct" | "classify" | "capture_only";
  readonly targetBrainKeys: readonly string[];
}) =>
  expect(
    buildBulkPolicyPlan({
      ...baseRequest,
      changes: [
        {
          channelKey: joinedChannel.channelKey,
          delivery: { mode: "requester_private" as const },
          routing,
        },
      ],
    })._tag,
  ).toBe("Left");

const indexInventory = (table: { readonly tableDefinition: unknown }) => {
  const definition = table.tableDefinition as {
    readonly indexes: readonly {
      readonly indexDescriptor: string;
      readonly fields: readonly string[];
    }[];
  };
  return Object.fromEntries(
    definition.indexes.map((index) => [
      index.indexDescriptor,
      [...index.fields],
    ]),
  );
};

describe("Slack channel policy contract", () => {
  it("pins public mutation args to authoritative actor resolution", () => {
    const args = bulkSetChannelPolicies.functionProvenance.args;

    expect(args.fields).not.toHaveProperty("actorRole");
    expect(args.fields).toHaveProperty("organizationKey");
    expect(args.fields).toHaveProperty("expectedChannelAccessGeneration");
  });

  it("exposes immutable routing and delivery policy indexes", () => {
    expect(
      indexInventory(channelRoutingPoliciesSource("channelRoutingPolicies")),
    ).toEqual({
      by_channel_epoch: ["channelKey", "policyEpoch"],
      by_channel_active: ["channelKey", "active"],
      by_organization_created: ["organizationKey", "createdAt"],
      by_organization_mode: ["organizationKey", "mode"],
      by_connection_generation: ["connectionKey", "connectionGeneration"],
    });
    expect(
      indexInventory(channelDeliveryPoliciesSource("channelDeliveryPolicies")),
    ).toEqual({
      by_channel_generation: ["channelKey", "deliveryGeneration"],
      by_channel_active: ["channelKey", "active"],
      by_organization_created: ["organizationKey", "createdAt"],
      by_organization_mode: ["organizationKey", "mode"],
    });
  });

  it("rejects non-admin, invalid targets, stale generation, capacity, connect delivery, and partial bulk", () => {
    expect(
      buildBulkPolicyPlan({ ...baseRequest, actorRole: "editor" })._tag,
    ).toBe("Left");
    expectRejectedChange({ mode: "direct", targetBrainKeys: [] });
    expectRejectedChange({
      mode: "direct",
      targetBrainKeys: ["brain_alpha", "brain_beta"],
    });
    expectRejectedChange({ mode: "classify", targetBrainKeys: [] });
    expectRejectedChange({
      mode: "classify",
      targetBrainKeys: ["brain_alpha", "brain_alpha"],
    });
    expectRejectedChange({
      mode: "capture_only",
      targetBrainKeys: ["brain_alpha"],
    });
    expect(
      buildBulkPolicyPlan({ ...baseRequest, expectedConnectionGeneration: 3 })
        ._tag,
    ).toBe("Left");
    expect(
      buildBulkPolicyPlan({
        ...baseRequest,
        expectedChannelAccessGeneration: 1,
      })._tag,
    ).toBe("Left");
    expect(
      buildBulkPolicyPlan({
        ...baseRequest,
        channels: [connectChannel],
        changes: [
          {
            channelKey: connectChannel.channelKey,
            routing: { mode: "direct", targetBrainKeys: ["brain_alpha"] },
            delivery: { mode: "requester_private" },
          },
        ],
      })._tag,
    ).toBe("Left");
    expect(
      buildBulkPolicyPlan({
        ...baseRequest,
        channels: Array.from({ length: 101 }, (_, index) => ({
          ...joinedChannel,
          channelKey: `slack_org_acme:C_${index}`,
          externalChannelId: `C_${index}`,
        })),
        changes: [],
      })._tag,
    ).toBe("Left");
    expect(
      buildBulkPolicyPlan({
        ...baseRequest,
        allowedBrainTargets: Array.from({ length: 26 }, (_, index) => ({
          brainKey: `brain_${index}`,
          name: `Brain ${index}`,
          organizationKey: "org_acme",
          kind: "client" as const,
          status: "active" as const,
        })),
      })._tag,
    ).toBe("Left");
    expect(
      buildBulkPolicyPlan({
        ...baseRequest,
        changes: [
          ...baseRequest.changes,
          {
            channelKey: "missing",
            routing: { mode: "capture_only", targetBrainKeys: [] },
            delivery: { mode: "capture_only" },
          },
        ],
      })._tag,
    ).toBe("Left");
  });

  it("rejects duplicate channel keys before planning active policies", () => {
    const planned = buildBulkPolicyPlan({
      ...baseRequest,
      changes: [
        ...baseRequest.changes,
        {
          channelKey: joinedChannel.channelKey,
          routing: { mode: "capture_only", targetBrainKeys: [] },
          delivery: { mode: "capture_only" },
        },
      ],
    });

    expect(planned._tag).toBe("Left");
    if (planned._tag === "Left") {
      expect(planned.left).toBeInstanceOf(PolicyInvalid);
      expect(planned.left._tag).toBe("PolicyInvalid");
      if (planned.left._tag === "PolicyInvalid") {
        expect(planned.left.reason).toBe("duplicate_channel_key");
      }
    }
  });

  it("creates all-or-nothing immutable epochs with first pending-source intervals", () => {
    const planned = buildBulkPolicyPlan(baseRequest);
    expect(planned._tag).toBe("Right");
    if (planned._tag === "Right") {
      expect(planned.right.routingPolicies).toHaveLength(1);
      expect(planned.right.deliveryPolicies).toHaveLength(1);
      const [routingPolicy] = planned.right.routingPolicies;
      expect(routingPolicy).toMatchObject({
        policyEpoch: 1,
        active: true,
        mode: "direct",
        targetBrainKeys: ["brain_alpha"],
        statusAfterApply: "streaming",
      });
      expect(routingPolicy?.pendingSourceInterval).toEqual({
        firstObservedAt: 2_000,
        status: "pending",
      });
      expect(planned.right.deliveryPolicies[0]).toMatchObject({
        deliveryGeneration: 1,
        mode: "requester_private",
      });
      expect(planned.right.auditRows).toEqual([
        {
          organizationKey: "org_acme",
          actorRole: "admin",
          action: "channel_policy_bulk_update",
          targetCount: 1,
          recordedAt: 2_000,
        },
      ]);
    }
  });

  it("increments immutable epochs and generations from existing active policies", () => {
    const planned = buildBulkPolicyPlan({
      ...baseRequest,
      changes: [
        {
          channelKey: joinedChannel.channelKey,
          routing: { mode: "direct", targetBrainKeys: ["brain_alpha"] },
          delivery: { mode: "requester_private" },
          expectedRoutingPolicyEpoch: 1,
          expectedDeliveryGeneration: 3,
        },
      ],
      existingRoutingPolicies: [
        {
          organizationKey: "org_acme",
          connectionKey: joinedChannel.connectionKey,
          connectionGeneration: 4,
          channelKey: joinedChannel.channelKey,
          policyEpoch: 1,
          active: true,
          mode: "capture_only",
          targetBrainKeys: [],
          statusAfterApply: "capture_only",
          pendingSourceInterval: { firstObservedAt: 1_500, status: "pending" },
          createdByRole: "admin",
          createdAt: 1_500,
        },
      ],
      existingDeliveryPolicies: [
        {
          organizationKey: "org_acme",
          channelKey: joinedChannel.channelKey,
          deliveryGeneration: 3,
          active: true,
          mode: "capture_only",
          createdByRole: "admin",
          createdAt: 1_500,
        },
      ],
    });

    expect(planned._tag).toBe("Right");
    if (planned._tag === "Right") {
      expect(planned.right.routingPolicies[0]?.policyEpoch).toBe(2);
      expect(planned.right.deliveryPolicies[0]?.deliveryGeneration).toBe(4);
    }
  });

  it("rejects stale active policy epochs and delivery generations", () => {
    const planned = buildBulkPolicyPlan({
      ...baseRequest,
      changes: [
        {
          channelKey: joinedChannel.channelKey,
          routing: { mode: "direct", targetBrainKeys: ["brain_alpha"] },
          delivery: { mode: "requester_private" },
          expectedRoutingPolicyEpoch: 1,
          expectedDeliveryGeneration: 3,
        },
      ],
      existingRoutingPolicies: [
        {
          organizationKey: "org_acme",
          connectionKey: joinedChannel.connectionKey,
          connectionGeneration: 4,
          channelKey: joinedChannel.channelKey,
          policyEpoch: 2,
          active: true,
          mode: "capture_only",
          targetBrainKeys: [],
          statusAfterApply: "capture_only",
          pendingSourceInterval: { firstObservedAt: 1_500, status: "pending" },
          createdByRole: "admin",
          createdAt: 1_500,
        },
      ],
      existingDeliveryPolicies: [
        {
          organizationKey: "org_acme",
          channelKey: joinedChannel.channelKey,
          deliveryGeneration: 4,
          active: true,
          mode: "capture_only",
          createdByRole: "admin",
          createdAt: 1_500,
        },
      ],
    });

    expect(planned._tag).toBe("Left");
    if (planned._tag === "Left") {
      expect(planned.left._tag).toBe("PolicyGenerationMismatch");
      if (planned.left._tag === "PolicyGenerationMismatch") {
        expect(planned.left.channelKey).toBe(joinedChannel.channelKey);
      }
    }
  });

  it("treats an identical active policy retry as idempotent", () => {
    const planned = buildBulkPolicyPlan({
      ...baseRequest,
      changes: [
        {
          channelKey: joinedChannel.channelKey,
          routing: { mode: "direct", targetBrainKeys: ["brain_alpha"] },
          delivery: { mode: "requester_private" },
          expectedRoutingPolicyEpoch: 1,
          expectedDeliveryGeneration: 1,
        },
      ],
      existingRoutingPolicies: [
        {
          organizationKey: "org_acme",
          connectionKey: joinedChannel.connectionKey,
          connectionGeneration: 4,
          channelKey: joinedChannel.channelKey,
          policyEpoch: 1,
          active: true,
          mode: "direct",
          targetBrainKeys: ["brain_alpha"],
          statusAfterApply: "streaming",
          pendingSourceInterval: { firstObservedAt: 1_500, status: "pending" },
          createdByRole: "admin",
          createdAt: 1_500,
        },
      ],
      existingDeliveryPolicies: [
        {
          organizationKey: "org_acme",
          channelKey: joinedChannel.channelKey,
          deliveryGeneration: 1,
          active: true,
          mode: "requester_private",
          createdByRole: "admin",
          createdAt: 1_500,
        },
      ],
    });

    expect(planned._tag).toBe("Right");
    if (planned._tag === "Right") {
      expect(planned.right.routingPolicies).toHaveLength(0);
      expect(planned.right.deliveryPolicies).toHaveLength(0);
      expect(planned.right.auditRows).toHaveLength(0);
    }
  });

  it("keeps Slack Connect delivery capture-only while allowing direct/classify ingestion", () => {
    const direct = buildBulkPolicyPlan({
      ...baseRequest,
      channels: [connectChannel],
      changes: [
        {
          channelKey: connectChannel.channelKey,
          routing: {
            mode: "classify",
            targetBrainKeys: ["brain_alpha", "brain_beta"],
          },
          delivery: { mode: "capture_only" },
        },
      ],
    });
    expect(direct._tag).toBe("Right");
  });

  it("counts only joined channels for launch capacity so non-joined rows cannot hide the 101st active channel", () => {
    const nonJoinedChannels = Array.from({ length: 150 }, (_, index) => ({
      ...joinedChannel,
      channelKey: `slack_org_acme:C_nonjoined_${index}`,
      externalChannelId: `C_nonjoined_${index}`,
      isMember: false,
      membershipStatus: "discovered_not_joined" as const,
    }));
    const activeJoinedChannels = Array.from({ length: 101 }, (_, index) => ({
      ...joinedChannel,
      channelKey: `slack_org_acme:C_joined_${index}`,
      externalChannelId: `C_joined_${index}`,
    }));

    const planned = buildBulkPolicyPlan({
      ...baseRequest,
      channels: [...nonJoinedChannels, ...activeJoinedChannels],
      changes: [],
    });

    expect(planned._tag).toBe("Left");
    if (planned._tag === "Left") {
      expect(planned.left._tag).toBe("CapacityExceeded");
      if (planned.left._tag === "CapacityExceeded") {
        expect(planned.left).toMatchObject({
          kind: "channels",
          limit: 100,
          actual: 101,
        });
      }
    }
  });

  it("derives immutable policy generations from complete channel history", () => {
    const historicalRoutingPolicies = Array.from(
      { length: 600 },
      (_, index) => ({
        organizationKey: "org_acme",
        connectionKey: joinedChannel.connectionKey,
        connectionGeneration: 4,
        channelKey: joinedChannel.channelKey,
        policyEpoch: index + 1,
        active: index === 599,
        mode: "capture_only" as const,
        targetBrainKeys: [],
        statusAfterApply: "capture_only" as const,
        pendingSourceInterval: {
          firstObservedAt: 1_000 + index,
          status: "pending" as const,
        },
        createdByRole: "admin" as const,
        createdAt: 1_000 + index,
      }),
    );
    const historicalDeliveryPolicies = Array.from(
      { length: 600 },
      (_, index) => ({
        organizationKey: "org_acme",
        channelKey: joinedChannel.channelKey,
        deliveryGeneration: index + 1,
        active: index === 599,
        mode: "capture_only" as const,
        createdByRole: "admin" as const,
        createdAt: 1_000 + index,
      }),
    );

    const planned = buildBulkPolicyPlan({
      ...baseRequest,
      changes: [
        {
          channelKey: joinedChannel.channelKey,
          routing: { mode: "direct", targetBrainKeys: ["brain_alpha"] },
          delivery: { mode: "requester_private" },
          expectedRoutingPolicyEpoch: 600,
          expectedDeliveryGeneration: 600,
        },
      ],
      existingRoutingPolicies: historicalRoutingPolicies,
      existingDeliveryPolicies: historicalDeliveryPolicies,
    });

    expect(planned._tag).toBe("Right");
    if (planned._tag === "Right") {
      expect(planned.right.routingPolicies[0]?.policyEpoch).toBe(601);
      expect(planned.right.deliveryPolicies[0]?.deliveryGeneration).toBe(601);
    }
  });
  it("returns typed PolicyInvalid reasons for invalid routing", () => {
    const planned = buildBulkPolicyPlan({
      ...baseRequest,
      changes: [
        {
          channelKey: joinedChannel.channelKey,
          delivery: { mode: "requester_private" as const },
          routing: { mode: "direct", targetBrainKeys: [] },
        },
      ],
    });
    expect(planned._tag).toBe("Left");
    if (planned._tag === "Left") {
      expect(planned.left).toBeInstanceOf(PolicyInvalid);
      expect(planned.left._tag).toBe("PolicyInvalid");
      if (planned.left._tag === "PolicyInvalid") {
        expect(planned.left.reason).toBe("direct_requires_one_target");
      }
    }
  });
});
