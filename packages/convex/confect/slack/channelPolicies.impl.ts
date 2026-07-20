import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Layer from "effect/Layer";

import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { type SourceChannelRowValue } from "../tables/sourceChannels";
import channelPolicies from "./channelPolicies.spec";
import { buildBulkPolicyPlan, type BrainTarget } from "./channelPolicy";

const bulkSetChannelPoliciesImpl = FunctionImpl.make(
  databaseSchema,
  channelPolicies,
  "bulkSetChannelPolicies",
  (input) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const reader = yield* DatabaseReader;
      const writer = yield* DatabaseWriter;
      const policyWriter = writer as unknown as {
        readonly table: (
          name: "channelRoutingPolicies" | "channelDeliveryPolicies",
        ) => {
          readonly insert: (row: unknown) => Effect.Effect<unknown, unknown>;
        };
      };
      const channels = (yield* reader
        .table("sourceChannels")
        .index("by_organization_membership_state", (q) =>
          q.eq("organizationKey", input.organizationKey),
        )
        .take(100)
        .pipe(Effect.orDie)) as readonly SourceChannelRowValue[];
      const workspaces = (yield* reader
        .table("workspaces")
        .index("by_organization_kind", (q) =>
          q.eq("organizationId", input.organizationKey).eq("kind", "client"),
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
          organizationKey: workspace.organizationId,
          kind: workspace.kind ?? "client",
          status: workspace.status,
        }));
      const planned = buildBulkPolicyPlan({
        organizationKey: input.organizationKey,
        actorRole: input.actorRole,
        expectedConnectionGeneration: input.expectedConnectionGeneration,
        now,
        channels,
        existingRoutingPolicies: [],
        existingDeliveryPolicies: [],
        allowedBrainTargets: brainTargets,
        changes: input.changes,
      });
      if (Either.isLeft(planned)) return yield* Effect.fail(planned.left);
      for (const routingPolicy of planned.right.routingPolicies) {
        yield* policyWriter
          .table("channelRoutingPolicies")
          .insert(routingPolicy)
          .pipe(Effect.orDie);
      }
      for (const deliveryPolicy of planned.right.deliveryPolicies) {
        yield* policyWriter
          .table("channelDeliveryPolicies")
          .insert(deliveryPolicy)
          .pipe(Effect.orDie);
      }
      return {
        applied: planned.right.routingPolicies.length,
        auditAction: "channel_policy_bulk_update" as const,
      };
    }),
);

export default GroupImpl.make(databaseSchema, channelPolicies).pipe(
  Layer.provide(bulkSetChannelPoliciesImpl),
  GroupImpl.finalize,
);
