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
const brainTargets = ["alpha", "beta"].map((name) => ({
  brainKey: `brain_${name}`,
  name,
  organizationKey: "org_acme",
  kind: "client" as const,
  status: "active" as const,
}));
const baseChange = {
  channelKey: joinedChannel.channelKey,
  routing: { mode: "direct" as const, targetBrainKeys: ["brain_alpha"] },
  delivery: { mode: "requester_private" as const },
};
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
  changes: [baseChange],
};
const existingRouting = {
  organizationKey: "org_acme",
  connectionKey: joinedChannel.connectionKey,
  connectionGeneration: 4,
  channelKey: joinedChannel.channelKey,
  policyEpoch: 1,
  active: true,
  mode: "direct" as const,
  targetBrainKeys: ["brain_alpha"],
  statusAfterApply: "streaming" as const,
  pendingSourceInterval: { firstObservedAt: 1_500, status: "pending" as const },
  createdByRole: "admin" as const,
  createdAt: 1_500,
};
const existingDelivery = {
  organizationKey: "org_acme",
  channelKey: joinedChannel.channelKey,
  deliveryGeneration: 3,
  active: true,
  mode: "requester_private" as const,
  createdByRole: "admin" as const,
  createdAt: 1_500,
};
const indexInventory = (table: { readonly tableDefinition: unknown }) =>
  Object.fromEntries(
    (
      table.tableDefinition as {
        readonly indexes: readonly {
          readonly indexDescriptor: string;
          readonly fields: readonly string[];
        }[];
      }
    ).indexes.map((index) => [index.indexDescriptor, [...index.fields]]),
  );
const expectLeft = (
  request: Parameters<typeof buildBulkPolicyPlan>[0],
  tag?: string,
) => {
  const planned = buildBulkPolicyPlan(request);
  expect(planned._tag).toBe("Left");
  if (planned._tag === "Left" && tag) expect(planned.left._tag).toBe(tag);
  return planned;
};
describe("Slack channel policy contract", () => {
  it("pins specs and immutable table indexes", () => {
    expect(
      bulkSetChannelPolicies.functionProvenance.args.fields,
    ).not.toHaveProperty("actorRole");
    expect(
      bulkSetChannelPolicies.functionProvenance.args.fields,
    ).toHaveProperty("expectedChannelAccessGeneration");
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
  it("rejects role,routing,generation,capacity,connect delivery,and partial bulk failures", () => {
    [
      { ...baseRequest, actorRole: "editor" as const },
      {
        ...baseRequest,
        changes: [
          {
            ...baseChange,
            routing: { mode: "direct" as const, targetBrainKeys: [] },
          },
        ],
      },
      {
        ...baseRequest,
        changes: [
          {
            ...baseChange,
            routing: {
              mode: "direct" as const,
              targetBrainKeys: ["brain_alpha", "brain_beta"],
            },
          },
        ],
      },
      {
        ...baseRequest,
        changes: [
          {
            ...baseChange,
            routing: { mode: "classify" as const, targetBrainKeys: [] },
          },
        ],
      },
      {
        ...baseRequest,
        changes: [
          {
            ...baseChange,
            routing: {
              mode: "classify" as const,
              targetBrainKeys: ["brain_alpha", "brain_alpha"],
            },
          },
        ],
      },
      {
        ...baseRequest,
        changes: [
          {
            ...baseChange,
            routing: {
              mode: "classify" as const,
              targetBrainKeys: ["brain_cross_org"],
            },
          },
        ],
      },
      {
        ...baseRequest,
        changes: [
          {
            ...baseChange,
            routing: {
              mode: "capture_only" as const,
              targetBrainKeys: ["brain_alpha"],
            },
          },
        ],
      },
      { ...baseRequest, expectedConnectionGeneration: 3 },
      { ...baseRequest, expectedChannelAccessGeneration: 1 },
      {
        ...baseRequest,
        channels: [connectChannel],
        changes: [
          {
            channelKey: connectChannel.channelKey,
            routing: {
              mode: "direct" as const,
              targetBrainKeys: ["brain_alpha"],
            },
            delivery: { mode: "requester_private" as const },
          },
        ],
      },
      {
        ...baseRequest,
        channels: Array.from({ length: 101 }, (_, index) => ({
          ...joinedChannel,
          channelKey: `slack_org_acme:C_${index}`,
          externalChannelId: `C_${index}`,
        })),
        changes: [],
      },
      {
        ...baseRequest,
        allowedBrainTargets: Array.from({ length: 26 }, (_, index) => ({
          brainKey: `brain_${index}`,
          organizationKey: "org_acme",
          kind: "client" as const,
          status: "active" as const,
        })),
      },
      {
        ...baseRequest,
        changes: [
          ...baseRequest.changes,
          {
            channelKey: "missing",
            routing: { mode: "capture_only" as const, targetBrainKeys: [] },
            delivery: { mode: "capture_only" as const },
          },
        ],
      },
      {
        ...baseRequest,
        changes: [
          ...baseRequest.changes,
          {
            ...baseChange,
            routing: { mode: "capture_only" as const, targetBrainKeys: [] },
            delivery: { mode: "capture_only" as const },
          },
        ],
      },
    ].forEach((request) => expectLeft(request));
  });
  it("creates immutable epochs,generations,audit rows,and first pending-source intervals", () => {
    const planned = buildBulkPolicyPlan(baseRequest);
    expect(planned._tag).toBe("Right");
    if (planned._tag === "Right")
      expect(planned.right).toMatchObject({
        routingPolicies: [
          {
            policyEpoch: 1,
            active: true,
            mode: "direct",
            targetBrainKeys: ["brain_alpha"],
            statusAfterApply: "streaming",
            pendingSourceInterval: {
              firstObservedAt: 2_000,
              status: "pending",
            },
          },
        ],
        deliveryPolicies: [
          { deliveryGeneration: 1, mode: "requester_private" },
        ],
        auditRows: [
          {
            organizationKey: "org_acme",
            actorRole: "admin",
            action: "channel_policy_bulk_update",
            targetCount: 1,
            recordedAt: 2_000,
          },
        ],
      });
  });
  it("increments from existing policy history,rejects stale active generations,and treats identical retry as idempotent", () => {
    const changed = {
      ...baseRequest,
      changes: [
        {
          ...baseChange,
          expectedRoutingPolicyEpoch: 1,
          expectedDeliveryGeneration: 3,
        },
      ],
      existingRoutingPolicies: [
        {
          ...existingRouting,
          mode: "capture_only" as const,
          targetBrainKeys: [],
          statusAfterApply: "capture_only" as const,
        },
      ],
      existingDeliveryPolicies: [
        { ...existingDelivery, mode: "capture_only" as const },
      ],
    };
    const planned = buildBulkPolicyPlan(changed);
    expect(planned._tag).toBe("Right");
    if (planned._tag === "Right")
      expect([
        planned.right.routingPolicies[0]?.policyEpoch,
        planned.right.deliveryPolicies[0]?.deliveryGeneration,
      ]).toEqual([2, 4]);
    expectLeft(
      {
        ...changed,
        existingRoutingPolicies: [{ ...existingRouting, policyEpoch: 2 }],
        existingDeliveryPolicies: [
          { ...existingDelivery, deliveryGeneration: 4 },
        ],
      },
      "PolicyGenerationMismatch",
    );
    const retry = buildBulkPolicyPlan({
      ...baseRequest,
      changes: [
        {
          ...baseChange,
          expectedRoutingPolicyEpoch: 1,
          expectedDeliveryGeneration: 3,
        },
      ],
      existingRoutingPolicies: [existingRouting],
      existingDeliveryPolicies: [existingDelivery],
    });
    expect(retry._tag).toBe("Right");
    if (retry._tag === "Right")
      expect([
        retry.right.routingPolicies.length,
        retry.right.deliveryPolicies.length,
        retry.right.auditRows.length,
      ]).toEqual([0, 0, 0]);
  });
  it("allows Slack Connect direct/classify ingestion only with capture-only delivery", () => {
    const planned = buildBulkPolicyPlan({
      ...baseRequest,
      channels: [connectChannel],
      changes: [
        {
          channelKey: connectChannel.channelKey,
          routing: {
            mode: "classify" as const,
            targetBrainKeys: ["brain_alpha", "brain_beta"],
          },
          delivery: { mode: "capture_only" as const },
        },
      ],
    });
    expect(planned._tag).toBe("Right");
  });
  it("covers capacity filtering,complete history generations,and one-sided policy changes", () => {
    expectLeft(
      {
        ...baseRequest,
        channels: [
          ...Array.from({ length: 150 }, (_, index) => ({
            ...joinedChannel,
            channelKey: `slack_org_acme:C_nonjoined_${index}`,
            isMember: false,
            membershipStatus: "discovered_not_joined" as const,
          })),
          ...Array.from({ length: 101 }, (_, index) => ({
            ...joinedChannel,
            channelKey: `slack_org_acme:C_joined_${index}`,
          })),
        ],
        changes: [],
      },
      "CapacityExceeded",
    );
    expectLeft(
      {
        ...baseRequest,
        allowedBrainTargets: [
          ...Array.from({ length: 26 }, (_, index) => ({
            brainKey: `brain_active_${index}`,
            organizationKey: "org_acme",
            kind: "client" as const,
            status: "active" as const,
          })),
          {
            brainKey: "brain_wrong",
            organizationKey: "org_other",
            kind: "client" as const,
            status: "active" as const,
          },
        ],
      },
      "CapacityExceeded",
    );
    const history = buildBulkPolicyPlan({
      ...baseRequest,
      changes: [
        {
          ...baseChange,
          expectedRoutingPolicyEpoch: 600,
          expectedDeliveryGeneration: 600,
        },
      ],
      existingRoutingPolicies: Array.from({ length: 600 }, (_, i) => ({
        ...existingRouting,
        policyEpoch: i + 1,
        active: i === 599,
        mode: "capture_only" as const,
        targetBrainKeys: [],
        statusAfterApply: "capture_only" as const,
      })),
      existingDeliveryPolicies: Array.from({ length: 600 }, (_, i) => ({
        ...existingDelivery,
        deliveryGeneration: i + 1,
        active: i === 599,
        mode: "capture_only" as const,
      })),
    });
    expect(history._tag).toBe("Right");
    if (history._tag === "Right")
      expect([
        history.right.routingPolicies[0]?.policyEpoch,
        history.right.deliveryPolicies[0]?.deliveryGeneration,
      ]).toEqual([601, 601]);
    const routingOnly = buildBulkPolicyPlan({
      ...baseRequest,
      now: 2_500,
      changes: [
        {
          ...baseChange,
          routing: { mode: "direct" as const, targetBrainKeys: ["brain_beta"] },
          expectedRoutingPolicyEpoch: 1,
          expectedDeliveryGeneration: 3,
        },
      ],
      existingRoutingPolicies: [existingRouting],
      existingDeliveryPolicies: [existingDelivery],
    });
    const deliveryOnly = buildBulkPolicyPlan({
      ...baseRequest,
      changes: [
        {
          ...baseChange,
          delivery: { mode: "capture_only" as const },
          expectedRoutingPolicyEpoch: 1,
          expectedDeliveryGeneration: 3,
        },
      ],
      existingRoutingPolicies: [existingRouting],
      existingDeliveryPolicies: [existingDelivery],
    });
    expect(routingOnly._tag).toBe("Right");
    expect(deliveryOnly._tag).toBe("Right");
    if (routingOnly._tag === "Right" && deliveryOnly._tag === "Right") {
      expect([
        routingOnly.right.routingPolicies.length,
        routingOnly.right.deliveryPolicies.length,
        routingOnly.right.routingPolicies[0]?.pendingSourceInterval
          ?.firstObservedAt,
      ]).toEqual([1, 0, 1_500]);
      expect([
        deliveryOnly.right.routingPolicies.length,
        deliveryOnly.right.deliveryPolicies.length,
        deliveryOnly.right.deliveryPolicies[0]?.deliveryGeneration,
      ]).toEqual([0, 1, 4]);
    }
  });
  it("returns typed PolicyInvalid reasons for invalid routing", () => {
    const planned = expectLeft(
      {
        ...baseRequest,
        changes: [
          {
            ...baseChange,
            routing: { mode: "direct" as const, targetBrainKeys: [] },
          },
        ],
      },
      "PolicyInvalid",
    );
    if (planned._tag === "Left") {
      expect(planned.left).toBeInstanceOf(PolicyInvalid);
      if (planned.left._tag === "PolicyInvalid")
        expect(planned.left.reason).toBe("direct_requires_one_target");
    }
  });
});
