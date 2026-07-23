import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Clock from "effect/Clock";
import type * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import {
  deniedPrivilegedAccessAuditEvent,
  recordAccessAuditEvent,
} from "../access/audit";
import { loadCurrentUser } from "../access/handlerContext";
import { roleAtLeast, type Role } from "../access/roles";
import type { ChannelDeliveryPolicyRowValue } from "../tables/channelDeliveryPolicies";
import type { ChannelRoutingPolicyRowValue } from "../tables/channelRoutingPolicies";
import type { SourceChannelRowValue } from "../tables/sourceChannels";
import channelPolicies from "./channelPolicies.spec";
import {
  buildBulkPolicyPlan,
  PolicyInvalid,
  type BrainTarget,
} from "./channelPolicy";

const bulkSetChannelPoliciesImpl = FunctionImpl.make(
  databaseSchema,
  channelPolicies,
  "bulkSetChannelPolicies",
  (input) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const policyReader = reader as unknown as PolicyReader;
      const policyWriter = writer as unknown as PolicyWriter;
      const organizationId = yield* resolveOrganizationId(
        reader,
        input.organizationKey,
      );
      const actor = yield* loadPolicyActor(reader, organizationId).pipe(
        Effect.tapError((error) =>
          recordAccessAuditEvent(
            writer,
            deniedPrivilegedAccessAuditEvent({
              workspaceId: organizationId,
              action: "slack.channelPolicyChanged",
              subjectKind: "privilegedAction",
              subjectId: input.organizationKey,
              reason: error._tag,
            }),
            now,
          ),
        ),
      );
      const channels = [
        ...((yield* reader
          .table("sourceChannels")
          .index("by_organization_membership_state", (q) =>
            q
              .eq("organizationKey", input.organizationKey)
              .eq("membershipStatus", "joined_needs_policy"),
          )
          .take(101)
          .pipe(Effect.orDie)) as readonly SourceChannelRowValue[]),
        ...((yield* reader
          .table("sourceChannels")
          .index("by_organization_membership_state", (q) =>
            q
              .eq("organizationKey", input.organizationKey)
              .eq("membershipStatus", "joined_active"),
          )
          .take(101)
          .pipe(Effect.orDie)) as readonly SourceChannelRowValue[]),
      ];
      const workspaces = (yield* reader
        .table("workspaces")
        .index("by_organization_kind", (q) =>
          q.eq("organizationId", organizationId).eq("kind", "client"),
        )
        .take(26)
        .pipe(Effect.orDie)) as readonly {
        readonly brainKey?: string;
        readonly name: string;
        readonly organizationId: string;
        readonly kind?: "client" | "agency";
        readonly status: string;
      }[];
      const brainTargets: readonly BrainTarget[] = workspaces
        .filter((workspace) => workspace.brainKey)
        .map((workspace) => ({
          brainKey: workspace.brainKey ?? "",
          name: workspace.name,
          organizationKey: input.organizationKey,
          kind: workspace.kind ?? "client",
          status: workspace.status,
        }));
      const existingRoutingPolicies = (yield* policyReader
        .table("channelRoutingPolicies")
        .index("by_organization_created", (q) =>
          q.eq("organizationKey", input.organizationKey),
        )
        .collect()
        .pipe(Effect.orDie)) as readonly ChannelRoutingPolicyRowValue[];
      const existingDeliveryPolicies = (yield* policyReader
        .table("channelDeliveryPolicies")
        .index("by_organization_created", (q) =>
          q.eq("organizationKey", input.organizationKey),
        )
        .collect()
        .pipe(Effect.orDie)) as readonly ChannelDeliveryPolicyRowValue[];
      const planned = buildBulkPolicyPlan({
        organizationKey: input.organizationKey,
        actorRole: actor.role,
        expectedConnectionGeneration: input.expectedConnectionGeneration,
        expectedChannelAccessGeneration: input.expectedChannelAccessGeneration,
        now,
        channels,
        existingRoutingPolicies,
        existingDeliveryPolicies,
        allowedBrainTargets: brainTargets,
        changes: input.changes,
      });
      if (Either.isLeft(planned)) return yield* Effect.fail(planned.left);
      for (const routingPolicy of planned.right.routingPolicies) {
        yield* deactivateActivePolicy(
          policyWriter,
          "channelRoutingPolicies",
          existingRoutingPolicies,
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
          existingDeliveryPolicies,
          deliveryPolicy.channelKey,
        );
        yield* policyWriter
          .table("channelDeliveryPolicies")
          .insert(deliveryPolicy)
          .pipe(Effect.orDie);
      }
      for (const auditRow of planned.right.auditRows) {
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
      }
      return {
        applied: planned.right.routingPolicies.length,
        auditAction: "channel_policy_bulk_update" as const,
      };
    }),
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
    ) => {
      readonly take: (limit: number) => Effect.Effect<unknown, unknown>;
      readonly collect: () => Effect.Effect<unknown, unknown>;
    };
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
    ) {
      return yield* Effect.fail(
        new PolicyInvalid({ reason: "admin_required" }),
      );
    }
    return { userId: user._id as string, role: member.value.role as Role };
  });

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

export default GroupImpl.make(databaseSchema, channelPolicies).pipe(
  Layer.provide(bulkSetChannelPoliciesImpl),
  GroupImpl.finalize,
);
