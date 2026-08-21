import { Ref } from "@confect/core";
import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Clock from "effect/Clock";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
import {
  DatabaseReader,
  DatabaseWriter,
  MutationRunner,
} from "../_generated/services";
import {
  deniedPrivilegedAccessAuditEvent,
  recordAccessAuditEvent,
} from "../access/audit";
import { loadCurrentUser } from "../access/handlerContext";
import { roleAtLeast, type Role } from "../access/roles";
import type { ChannelDeliveryPolicyRowValue } from "../tables/channelDeliveryPolicies";
import type { ChannelRoutingPolicyRowValue } from "../tables/channelRoutingPolicies";
import type { SourceChannelRowValue } from "../tables/sourceChannels";
import channelPolicies, { recordDenialAudit } from "./channelPolicies.spec";
import {
  buildBulkPolicyPlan,
  PolicyInvalid,
  type BrainTarget,
} from "./channelPolicy";

const recordDenialAuditRef = Ref.make(
  "slack/channelPolicies",
  recordDenialAudit,
);

type PolicyReader = {
  readonly table: (
    name: "channelRoutingPolicies" | "channelDeliveryPolicies",
  ) => {
    readonly index: (
      indexName: "by_organization_created",
      range: (q: {
        readonly eq: (field: string, value: string) => unknown;
      }) => unknown,
    ) => { readonly collect: () => Effect.Effect<unknown, unknown> };
  };
};
type PolicyWriter = {
  readonly table: (
    name: "channelRoutingPolicies" | "channelDeliveryPolicies",
  ) => {
    readonly insert: (row: unknown) => Effect.Effect<unknown, unknown>;
    readonly patch: (
      id: string,
      row: unknown,
    ) => Effect.Effect<unknown, unknown>;
  };
};
const resolveOrganizationId = (
  reader: Context.Tag.Service<typeof DatabaseReader>,
  organizationKey: string,
) =>
  Effect.gen(function* () {
    const organization = yield* reader
      .table("organizations")
      .index("by_agency_key", (q) => q.eq("agencyKey", organizationKey))
      .first()
      .pipe(Effect.orDie);
    if (organization._tag === "Some") return organization.value._id as string;
    return yield* Effect.fail(new PolicyInvalid({ reason: "admin_required" }));
  });
const joinedStatuses: readonly SourceChannelRowValue["membershipStatus"][] = [
  "joined_needs_policy",
  "joined_active",
];
const loadChannels = (
  reader: Context.Tag.Service<typeof DatabaseReader>,
  organizationKey: string,
) =>
  Effect.all(
    joinedStatuses.map((status) =>
      reader
        .table("sourceChannels")
        .index("by_organization_membership_state", (q) =>
          q
            .eq("organizationKey", organizationKey)
            .eq("membershipStatus", status),
        )
        .take(101)
        .pipe(Effect.orDie),
    ),
  ).pipe(
    Effect.map((groups) => groups.flat() as readonly SourceChannelRowValue[]),
  );
const loadBrainTargets = (
  reader: Context.Tag.Service<typeof DatabaseReader>,
  organizationId: string,
) =>
  reader
    .table("workspaces")
    .index("by_organization", (q) => q.eq("organizationId", organizationId))
    .take(26)
    .pipe(Effect.orDie) as Effect.Effect<
    readonly {
      readonly brainKey?: string;
      readonly name?: string;
      readonly organizationId: string;
      readonly kind?: "client" | "agency";
      readonly status: string;
    }[],
    never
  >;
const loadPolicies = (reader: PolicyReader, organizationKey: string) =>
  Effect.all({
    routing: reader
      .table("channelRoutingPolicies")
      .index("by_organization_created", (q) =>
        q.eq("organizationKey", organizationKey),
      )
      .collect()
      .pipe(Effect.orDie) as Effect.Effect<
      readonly ChannelRoutingPolicyRowValue[],
      never
    >,
    delivery: reader
      .table("channelDeliveryPolicies")
      .index("by_organization_created", (q) =>
        q.eq("organizationKey", organizationKey),
      )
      .collect()
      .pipe(Effect.orDie) as Effect.Effect<
      readonly ChannelDeliveryPolicyRowValue[],
      never
    >,
  });
const activeMap = <
  T extends { readonly channelKey: string; readonly active: boolean },
>(
  rows: readonly T[],
) =>
  new Map(rows.filter((row) => row.active).map((row) => [row.channelKey, row]));
const loadPolicyActor = (
  reader: Context.Tag.Service<typeof DatabaseReader>,
  organizationId: string,
) =>
  Effect.gen(function* () {
    const user = yield* loadCurrentUser(reader).pipe(
      Effect.mapError(() => new PolicyInvalid({ reason: "admin_required" })),
    );
    const member = yield* reader
      .table("organizationMembers")
      .index("by_organization_user", (q) =>
        q.eq("organizationId", organizationId).eq("userId", user._id),
      )
      .first()
      .pipe(Effect.orDie);
    if (
      member._tag === "None" ||
      member.value.status !== "active" ||
      member.value.acceptedAt === null ||
      member.value.revokedAt !== null ||
      !roleAtLeast(member.value.role, "admin")
    )
      return yield* Effect.fail(
        new PolicyInvalid({ reason: "admin_required" }),
      );
    return { userId: user._id as string, role: member.value.role as Role };
  });
const recordPolicyDenial = <E>(
  runMutation: Context.Tag.Service<typeof MutationRunner>,
  organizationKey: string,
  reason: string,
  error: E,
): Effect.Effect<never, E> =>
  runMutation(recordDenialAuditRef, {
    organizationKey,
    reason,
  }).pipe(
    Effect.orDie,
    Effect.flatMap(() => Effect.fail(error)),
  );
const deactivateActivePolicy = (
  writer: PolicyWriter,
  tableName: "channelRoutingPolicies" | "channelDeliveryPolicies",
  policies: readonly {
    readonly _id?: string;
    readonly channelKey: string;
    readonly active: boolean;
  }[],
  channelKey: string,
) =>
  Effect.forEach(
    policies.filter(
      (policy) =>
        policy.channelKey === channelKey && policy.active && policy._id,
    ),
    (policy) =>
      writer
        .table(tableName)
        .patch(policy._id ?? "", { active: false })
        .pipe(Effect.orDie),
  ).pipe(Effect.asVoid);
const getChannelPolicyReadModelImpl = FunctionImpl.make(
  databaseSchema,
  channelPolicies,
  "getChannelPolicyReadModel",
  (input) =>
    Effect.gen(function* () {
      const reader = yield* DatabaseReader;
      const organizationId = yield* resolveOrganizationId(
        reader,
        input.organizationKey,
      );
      yield* loadPolicyActor(reader, organizationId);
      const [channels, workspaces, policies] = yield* Effect.all([
        loadChannels(reader, input.organizationKey),
        loadBrainTargets(reader, organizationId),
        loadPolicies(reader as unknown as PolicyReader, input.organizationKey),
      ] as const);
      const activeRouting = activeMap(policies.routing);
      const activeDelivery = activeMap(policies.delivery);
      return {
        channels: channels.map((channel) => {
          const routing = activeRouting.get(channel.channelKey);
          const delivery = activeDelivery.get(channel.channelKey);
          return {
            organizationKey: channel.organizationKey,
            channelKey: channel.channelKey,
            name: channel.name,
            membershipStatus: channel.membershipStatus,
            isShared: channel.isShared,
            isExtShared: channel.isExtShared,
            connectionGeneration: channel.connectionGeneration,
            accessGeneration: channel.accessGeneration,
            activeRoutingPolicy: routing
              ? {
                  policyEpoch: routing.policyEpoch,
                  statusAfterApply: routing.statusAfterApply,
                }
              : undefined,
            activeDeliveryPolicy: delivery
              ? { deliveryGeneration: delivery.deliveryGeneration }
              : undefined,
          };
        }),
        clientBrains: workspaces.flatMap((workspace) =>
          workspace.brainKey
            ? [
                {
                  organizationKey: input.organizationKey,
                  brainKey: workspace.brainKey,
                  kind: workspace.kind ?? "client",
                  status: workspace.status,
                },
              ]
            : [],
        ),
      };
    }),
);
const bulkSetChannelPoliciesImpl = FunctionImpl.make(
  databaseSchema,
  channelPolicies,
  "bulkSetChannelPolicies",
  (input) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const runMutation = yield* MutationRunner;
      const organizationId = yield* resolveOrganizationId(
        reader,
        input.organizationKey,
      );
      const actor = yield* loadPolicyActor(reader, organizationId).pipe(
        Effect.catchAll((error) =>
          recordPolicyDenial(
            runMutation,
            input.organizationKey,
            error._tag,
            error,
          ),
        ),
      );
      const [channels, workspaces, policies] = yield* Effect.all([
        loadChannels(reader, input.organizationKey),
        loadBrainTargets(reader, organizationId),
        loadPolicies(reader as unknown as PolicyReader, input.organizationKey),
      ] as const);
      const planned = buildBulkPolicyPlan({
        organizationKey: input.organizationKey,
        actorRole: actor.role,
        expectedConnectionGeneration: input.expectedConnectionGeneration,
        expectedChannelAccessGeneration: input.expectedChannelAccessGeneration,
        now,
        channels,
        existingRoutingPolicies: policies.routing,
        existingDeliveryPolicies: policies.delivery,
        allowedBrainTargets: workspaces
          .filter((workspace) => workspace.brainKey)
          .map((workspace): BrainTarget => ({
            brainKey: workspace.brainKey ?? "",
            organizationKey: input.organizationKey,
            kind: workspace.kind ?? "client",
            status: workspace.status,
          })),
        changes: input.changes,
      });
      if (Either.isLeft(planned)) return yield* Effect.fail(planned.left);
      const policyWriter = writer as unknown as PolicyWriter;
      for (const routingPolicy of planned.right.routingPolicies) {
        yield* deactivateActivePolicy(
          policyWriter,
          "channelRoutingPolicies",
          policies.routing,
          routingPolicy.channelKey,
        );
        yield* policyWriter
          .table("channelRoutingPolicies")
          .insert(routingPolicy)
          .pipe(Effect.orDie);
      }
      for (const deliveryPolicy of planned.right.deliveryPolicies) {
        yield* deactivateActivePolicy(
          policyWriter,
          "channelDeliveryPolicies",
          policies.delivery,
          deliveryPolicy.channelKey,
        );
        yield* policyWriter
          .table("channelDeliveryPolicies")
          .insert(deliveryPolicy)
          .pipe(Effect.orDie);
      }
      for (const auditRow of planned.right.auditRows)
        yield* recordAccessAuditEvent(
          writer,
          {
            workspaceId: organizationId,
            action: "slack.channelPolicyChanged",
            actorUserId: actor.userId,
            subjectKind: "privilegedAction",
            subjectId: input.organizationKey,
            metadata: {
              outcome: "success",
              action: auditRow.action,
              targetCount: auditRow.targetCount,
            },
          },
          now,
        );
      return {
        applied: planned.right.routingPolicies.length,
        auditAction: "channel_policy_bulk_update" as const,
      };
    }),
);
const recordDenialAuditImpl = FunctionImpl.make(
  databaseSchema,
  channelPolicies,
  "recordDenialAudit",
  ({ organizationKey, reason }) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const organizationId = yield* resolveOrganizationId(
        reader,
        organizationKey,
      );
      const actor = yield* loadCurrentUser(reader).pipe(Effect.option);
      yield* recordAccessAuditEvent(
        writer,
        deniedPrivilegedAccessAuditEvent({
          workspaceId: organizationId,
          action: "slack.channelPolicyChanged",
          ...(actor._tag === "Some" ? { actorUserId: actor.value._id } : {}),
          subjectKind: "privilegedAction",
          subjectId: organizationKey,
          reason,
        }),
        now,
      );
      return null;
    }),
);
export default GroupImpl.make(databaseSchema, channelPolicies).pipe(
  Layer.provide(recordDenialAuditImpl),
  Layer.provide(getChannelPolicyReadModelImpl),
  Layer.provide(bulkSetChannelPoliciesImpl),
  GroupImpl.finalize,
);
