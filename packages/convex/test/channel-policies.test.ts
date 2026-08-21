import { Ref } from "@confect/core";
import {
  DatabaseSchema,
  RegisteredConvexFunction,
  RegisteredFunctions,
} from "@confect/server";
import { TestConfect } from "@confect/test";
import { defineSchema } from "convex/server";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import { Id } from "../confect/_generated/id";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import channelPoliciesImpl from "../confect/slack/channelPolicies.impl";
import channelPolicies, {
  bulkSetChannelPolicies,
} from "../confect/slack/channelPolicies.spec";
import channelDeliveryPoliciesSource from "../confect/tables/channelDeliveryPolicies";
import channelRoutingPoliciesSource from "../confect/tables/channelRoutingPolicies";
import sourceChannelsSource from "../confect/tables/sourceChannels";
import {
  PolicyInvalid,
  buildBulkPolicyPlan,
} from "../confect/slack/channelPolicy";

const bulkSetRef = Ref.make("slack/channelPolicies", bulkSetChannelPolicies);

const channelDeliveryPolicies = channelDeliveryPoliciesSource(
  "channelDeliveryPolicies",
);
const channelRoutingPolicies = channelRoutingPoliciesSource(
  "channelRoutingPolicies",
);
const sourceChannels = sourceChannelsSource("sourceChannels");
const transientDatabaseSchema = DatabaseSchema.make({
  ...databaseSchema.tables,
  channelDeliveryPolicies,
  channelRoutingPolicies,
  sourceChannels,
});
const transientConvexSchema = defineSchema({
  ...Object.fromEntries(
    Object.entries(databaseSchema.tables).map(([name, table]) => [
      name,
      table.tableDefinition,
    ]),
  ),
  channelDeliveryPolicies: channelDeliveryPolicies.tableDefinition,
  channelRoutingPolicies: channelRoutingPolicies.tableDefinition,
  sourceChannels: sourceChannels.tableDefinition,
});
const channelPolicyRegisteredFunctions = RegisteredFunctions.buildForGroup<
  typeof channelPolicies
>(transientDatabaseSchema, channelPoliciesImpl, RegisteredConvexFunction.make);
const channelPolicyTestConfectLayer = TestConfect.layer(
  transientDatabaseSchema,
  transientConvexSchema,
  {
    ...import.meta.glob("../convex/**/!(*.*.*)*.*s"),
    "../convex/slack/channelPolicies.ts": async () =>
      channelPolicyRegisteredFunctions,
  },
);

const identity = {
  subject: "admin-subject",
  email: "admin@example.com",
  emailVerified: true,
};

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
      by_organization_active: ["organizationKey", "active"],
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

  it("allows an active agency Brain with a bounded history start", () => {
    const planned = buildBulkPolicyPlan({
      ...baseRequest,
      allowedBrainTargets: [
        ...baseRequest.allowedBrainTargets,
        {
          brainKey: "brain_agency",
          organizationKey: "org_acme",
          kind: "agency",
          status: "active",
        },
      ],
      changes: [
        {
          channelKey: joinedChannel.channelKey,
          routing: {
            mode: "direct",
            targetBrainKeys: ["brain_agency"],
            historicalBackfillStartAt: 50,
          },
          delivery: { mode: "capture_only" },
        },
      ],
    });
    expect(planned._tag).toBe("Right");
    if (planned._tag === "Right")
      expect(planned.right.routingPolicies[0]).toMatchObject({
        targetBrainKeys: ["brain_agency"],
        historicalBackfillStartAt: 50,
      });
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
  it("authorizes stable agency policy keys through durable organization membership only", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      const authed = confect.withIdentity(identity);
      const seeded = yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          const userId = yield* writer
            .table("users")
            .insert({
              subject: "admin-subject",
              email: "admin@example.com",
              displayName: "Admin",
              status: "active",
              createdAt: 1_000,
              updatedAt: 1_000,
            })
            .pipe(Effect.orDie);
          const organizationId = yield* writer
            .table("organizations")
            .insert({
              ownerUserId: userId,
              name: "Acme",
              slug: "acme",
              status: "active",
              agencyKey: "agency_acme",
              createdAt: 1_000,
              updatedAt: 1_000,
            })
            .pipe(Effect.orDie);
          const otherOrganizationId = yield* writer
            .table("organizations")
            .insert({
              ownerUserId: userId,
              name: "Other",
              slug: "other",
              status: "active",
              agencyKey: "agency_other",
              createdAt: 1_000,
              updatedAt: 1_000,
            })
            .pipe(Effect.orDie);
          yield* writer
            .table("organizationMembers")
            .insert({
              organizationId,
              userId,
              role: "admin",
              status: "active",
              acceptedAt: 1_000,
              revokedAt: null,
              createdAt: 1_000,
              updatedAt: 1_000,
            })
            .pipe(Effect.orDie);
          const seededWorkspaceId = yield* writer
            .table("workspaces")
            .insert({
              organizationId,
              ownerUserId: userId,
              brainKey: "brain_alpha",
              slug: "alpha",
              name: "Alpha",
              kind: "client",
              status: "active",
              dataClassification: "confidential",
              createdAt: 1_000,
              updatedAt: 1_000,
            })
            .pipe(Effect.orDie);
          const betaWorkspaceId = yield* writer
            .table("workspaces")
            .insert({
              organizationId,
              ownerUserId: userId,
              brainKey: "brain_beta",
              slug: "beta",
              name: "Beta",
              kind: "client",
              status: "active",
              dataClassification: "confidential",
              createdAt: 1_000,
              updatedAt: 1_000,
            })
            .pipe(Effect.orDie);
          yield* writer
            .table("sourceChannels")
            .insert({ ...joinedChannel, organizationKey: "agency_acme" })
            .pipe(Effect.orDie);
          return {
            organizationId,
            otherOrganizationId,
            seededWorkspaceId,
            betaWorkspaceId,
          };
        }),
        Schema.Struct({
          organizationId: Id("organizations"),
          otherOrganizationId: Id("organizations"),
          seededWorkspaceId: Id("workspaces"),
          betaWorkspaceId: Id("workspaces"),
        }),
      );

      const applied = yield* authed.mutation(bulkSetRef, {
        organizationKey: "agency_acme",
        expectedConnectionGeneration: 4,
        expectedChannelAccessGeneration: 2,
        changes: baseRequest.changes,
      });
      const reassigned = yield* authed.mutation(bulkSetRef, {
        organizationKey: "agency_acme",
        expectedConnectionGeneration: 4,
        expectedChannelAccessGeneration: 2,
        changes: [
          {
            channelKey: joinedChannel.channelKey,
            expectedRoutingPolicyEpoch: 1,
            expectedDeliveryGeneration: 1,
            routing: {
              mode: "direct",
              targetBrainKeys: ["brain_beta"],
            },
            delivery: { mode: "requester_private" },
          },
        ],
      });
      const denied = yield* Effect.either(
        authed.mutation(bulkSetRef, {
          organizationKey: "agency_other",
          expectedConnectionGeneration: 4,
          expectedChannelAccessGeneration: 2,
          changes: baseRequest.changes,
        }),
      );
      const rows = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const policyReader = reader as unknown as {
            table: (name: "channelRoutingPolicies") => {
              index: (
                name: "by_organization_created",
                range: (q: {
                  eq: (field: string, value: string) => unknown;
                }) => unknown,
              ) => { collect: () => Effect.Effect<unknown, unknown> };
            };
          };
          const routing = yield* policyReader
            .table("channelRoutingPolicies")
            .index("by_organization_created", (q) =>
              q.eq("organizationKey", "agency_acme"),
            )
            .collect()
            .pipe(Effect.orDie);
          const [removedTargetJobs, addedTargetJobs] = yield* Effect.all([
            reader
              .table("retrievalPublicationJobs")
              .index("by_origin_target", (query) =>
                query
                  .eq("workspaceId", seeded.seededWorkspaceId)
                  .eq("brainKey", "brain_alpha")
                  .eq("originKind", "slack_rebuild")
                  .eq(
                    "sourceRevisionKey",
                    `policy:${joinedChannel.channelKey}:2`,
                  ),
              )
              .take(5)
              .pipe(Effect.orDie),
            reader
              .table("retrievalPublicationJobs")
              .index("by_origin_target", (query) =>
                query
                  .eq("workspaceId", seeded.betaWorkspaceId)
                  .eq("brainKey", "brain_beta")
                  .eq("originKind", "slack_rebuild")
                  .eq(
                    "sourceRevisionKey",
                    `policy:${joinedChannel.channelKey}:2`,
                  ),
              )
              .take(5)
              .pipe(Effect.orDie),
          ]);
          const policyFences = yield* reader
            .table("retrievalEligibilityFences")
            .index("by_organization_kind_controller", (query) =>
              query.eq("organizationKey", "agency_acme").eq("kind", "policy"),
            )
            .take(10)
            .pipe(Effect.orDie);
          return {
            routing,
            removedTargetJobs,
            addedTargetJobs,
            policyFences,
          };
        }),
        Schema.Any,
      );

      return { applied, reassigned, denied, rows, seeded };
    }).pipe(Effect.provide(channelPolicyTestConfectLayer()));

    const result = await Effect.runPromise(program);

    expect(result.applied).toEqual({
      applied: 1,
      auditAction: "channel_policy_bulk_update",
    });
    expect(result.reassigned).toEqual({
      applied: 1,
      auditAction: "channel_policy_bulk_update",
    });
    expect(result.rows.routing).toHaveLength(2);
    expect(result.rows.removedTargetJobs).toEqual([
      expect.objectContaining({
        status: "pending",
        sourceKey: joinedChannel.channelKey,
        rebuild: { limit: 5 },
      }),
    ]);
    expect(result.rows.addedTargetJobs).toEqual([
      expect.objectContaining({
        status: "pending",
        sourceKey: joinedChannel.channelKey,
        rebuild: { limit: 5 },
      }),
    ]);
    expect(result.rows.policyFences).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          controllerKey: `slack-policy:${joinedChannel.channelKey}:brain_alpha`,
          eligibilityGeneration: 2,
          eligible: false,
        }),
        expect.objectContaining({
          controllerKey: `slack-policy:${joinedChannel.channelKey}:brain_beta`,
          eligibilityGeneration: 1,
          eligible: true,
        }),
      ]),
    );
    expect(result.denied._tag).toBe("Left");
    if (result.denied._tag === "Left") {
      expect(result.denied.left).toMatchObject({
        _tag: "PolicyInvalid",
        reason: "admin_required",
      });
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
