import { Ref } from "@confect/core";
import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
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
import { sha256Hex } from "../shared/sha256";
import {
  deniedPrivilegedAccessAuditEvent,
  recordAccessAuditEvent,
} from "../access/audit";
import { loadCurrentUser } from "../access/handlerContext";
import { roleAtLeast, type Role } from "../access/roles";
import {
  slackPolicyFenceIdentity,
  transitionEligibilityFenceEffect,
} from "../brain/retrievalEligibility";
import { enqueueRetrievalPublicationJobEffect } from "../brain/retrievalPublication.impl";
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

const stableKey = (prefix: string, value: unknown): string =>
  `${prefix}_${sha256Hex(JSON.stringify(value))}`;

const slackPolicyConfigurationDigest = (input: {
  readonly organizationKey: string;
  readonly channelKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly policyEpoch: number;
  readonly mode: "direct" | "classify";
  readonly targetBrainKeys: readonly string[];
}) =>
  `sha256:${sha256Hex(
    JSON.stringify({
      authorityKind: "live_capture",
      providerKind: "slack",
      organizationKey: input.organizationKey,
      connectorScopeKey: input.channelKey,
      connectionKey: input.connectionKey,
      connectionGeneration: input.connectionGeneration,
      policies: [
        {
          policyEpoch: input.policyEpoch,
          mode: input.mode,
          targetBrainKeys: [...input.targetBrainKeys].sort(),
        },
      ],
    }),
  )}`;

const ensureSlackRequiredScopeForPolicyEffect = (input: {
  readonly reader: Context.Tag.Service<typeof DatabaseReader>;
  readonly writer: Context.Tag.Service<typeof DatabaseWriter>;
  readonly organizationKey: string;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly channelKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly policyEpoch: number;
  readonly controllingConfigurationDigest: string;
  readonly now: number;
}) =>
  Effect.gen(function* () {
    const allowlistGeneration = input.policyEpoch;
    const allowlistGenerationKey = stableKey("calg", {
      connectorScopeKey: input.channelKey,
      connectionGeneration: input.connectionGeneration,
      allowlistGeneration,
      controllingConfigurationDigest: input.controllingConfigurationDigest,
    });
    const allowlists = yield* input.reader
      .table("connectorAllowlistGenerations")
      .index("by_scope_generation", (query) =>
        query
          .eq("connectorScopeKey", input.channelKey)
          .eq("allowlistGeneration", allowlistGeneration),
      )
      .take(2)
      .pipe(Effect.orDie);
    const allowlist = allowlists[0];
    if (
      allowlists.length > 1 ||
      (allowlist !== undefined &&
        (allowlist.organizationKey !== input.organizationKey ||
          allowlist.allowlistGenerationKey !== allowlistGenerationKey ||
          allowlist.connectionKey !== input.connectionKey ||
          allowlist.connectionGeneration !== input.connectionGeneration ||
          allowlist.configurationDigest !==
            input.controllingConfigurationDigest))
    )
      return yield* Effect.dieMessage(
        "Slack policy allowlist authority conflicts.",
      );
    if (allowlist === undefined)
      yield* input.writer
        .table("connectorAllowlistGenerations")
        .insert({
          schemaVersion: 1,
          organizationKey: input.organizationKey,
          connectorScopeKey: input.channelKey,
          allowlistGenerationKey,
          connectionKey: input.connectionKey,
          connectionGeneration: input.connectionGeneration,
          allowlistGeneration,
          configurationDigest: input.controllingConfigurationDigest,
          memberCount: 0,
          state: "current",
          createdAt: input.now,
          supersededAt: null,
        })
        .pipe(Effect.orDie);

    const scopes = yield* input.reader
      .table("connectorScopes")
      .index("by_connector_scope_key", (query) =>
        query.eq("connectorScopeKey", input.channelKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    const scope = scopes[0];
    if (
      scopes.length > 1 ||
      (scope !== undefined &&
        (scope.organizationKey !== input.organizationKey ||
          scope.providerKind !== "slack" ||
          scope.providerContainerKey !== input.channelKey ||
          scope.connectionKey !== input.connectionKey))
    )
      return yield* Effect.dieMessage(
        "Slack policy connector-scope authority conflicts.",
      );
    if (scope === undefined)
      yield* input.writer
        .table("connectorScopes")
        .insert({
          schemaVersion: 1,
          organizationKey: input.organizationKey,
          connectorScopeKey: input.channelKey,
          providerKind: "slack",
          providerContainerKey: input.channelKey,
          connectionKey: input.connectionKey,
          currentConnectionGeneration: input.connectionGeneration,
          currentAllowlistGeneration: allowlistGeneration,
          scopeGeneration: 1,
          state: "active",
          createdAt: input.now,
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);
    else if (
      scope.state !== "active" ||
      scope.currentConnectionGeneration !== input.connectionGeneration ||
      scope.currentAllowlistGeneration !== allowlistGeneration
    )
      yield* input.writer
        .table("connectorScopes")
        .patch(scope._id, {
          currentConnectionGeneration: input.connectionGeneration,
          currentAllowlistGeneration: allowlistGeneration,
          scopeGeneration: scope.scopeGeneration + 1,
          state: "active",
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);

    const requiredScopeIntentKey = stableKey("brsi", {
      workspaceId: input.workspaceId,
      brainKey: input.brainKey,
      corpusKey: "slack",
      providerKind: "slack",
      connectorScopeKey: input.channelKey,
    });
    const requiredRows = yield* input.reader
      .table("brainRequiredScopeIntents")
      .index("by_required_scope_intent_key", (query) =>
        query.eq("requiredScopeIntentKey", requiredScopeIntentKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    const required = requiredRows[0];
    if (requiredRows.length > 1)
      return yield* Effect.dieMessage(
        "Slack policy required-scope authority is ambiguous.",
      );
    const exact =
      required !== undefined &&
      required.organizationKey === input.organizationKey &&
      required.workspaceId === input.workspaceId &&
      required.brainKey === input.brainKey &&
      required.corpusKey === "slack" &&
      required.providerKind === "slack" &&
      required.connectorScopeKey === input.channelKey &&
      required.connectionKey === input.connectionKey &&
      required.connectionGeneration === input.connectionGeneration &&
      required.allowlistGeneration === allowlistGeneration &&
      required.controllingConfigurationDigest ===
        input.controllingConfigurationDigest &&
      required.state === "required";
    if (!exact) {
      const row = {
        schemaVersion: 1 as const,
        organizationKey: input.organizationKey,
        workspaceId: input.workspaceId,
        brainKey: input.brainKey,
        corpusKey: "slack" as const,
        providerKind: "slack" as const,
        connectorScopeKey: input.channelKey,
        connectionKey: input.connectionKey,
        connectionGeneration: input.connectionGeneration,
        allowlistGeneration,
        requiredScopeIntentKey,
        intentGeneration: (required?.intentGeneration ?? 0) + 1,
        controllingConfigurationDigest: input.controllingConfigurationDigest,
        state: "required" as const,
        decommissionGeneration: null,
        activatedAt:
          required?.state === "required" ? required.activatedAt : input.now,
        decommissionedAt: null,
        updatedAt: input.now,
      };
      if (required === undefined)
        yield* input.writer
          .table("brainRequiredScopeIntents")
          .insert(row)
          .pipe(Effect.orDie);
      else
        yield* input.writer
          .table("brainRequiredScopeIntents")
          .patch(required._id, row)
          .pipe(Effect.orDie);
    }
  });

const decommissionSlackRequiredScopeForPolicyEffect = (input: {
  readonly reader: Context.Tag.Service<typeof DatabaseReader>;
  readonly writer: Context.Tag.Service<typeof DatabaseWriter>;
  readonly workspaceId: GenericId<"workspaces">;
  readonly brainKey: string;
  readonly channelKey: string;
  readonly now: number;
}) =>
  Effect.gen(function* () {
    const requiredScopeIntentKey = stableKey("brsi", {
      workspaceId: input.workspaceId,
      brainKey: input.brainKey,
      corpusKey: "slack",
      providerKind: "slack",
      connectorScopeKey: input.channelKey,
    });
    const rows = yield* input.reader
      .table("brainRequiredScopeIntents")
      .index("by_required_scope_intent_key", (query) =>
        query.eq("requiredScopeIntentKey", requiredScopeIntentKey),
      )
      .take(2)
      .pipe(Effect.orDie);
    if (rows.length > 1)
      return yield* Effect.dieMessage(
        "Slack policy required-scope authority is ambiguous.",
      );
    const required = rows[0];
    if (required?.state === "required")
      yield* input.writer
        .table("brainRequiredScopeIntents")
        .patch(required._id, {
          state: "decommissioned",
          decommissionGeneration: required.intentGeneration,
          decommissionedAt: input.now,
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);
  });

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
      readonly _id: GenericId<"workspaces">;
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
      const priorActiveRouting = activeMap(policies.routing);
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
        const priorTargets = new Set(
          priorActiveRouting.get(routingPolicy.channelKey)?.mode ===
            "capture_only"
            ? []
            : (priorActiveRouting.get(routingPolicy.channelKey)
                ?.targetBrainKeys ?? []),
        );
        const currentTargets = new Set(
          routingPolicy.mode === "capture_only"
            ? []
            : routingPolicy.targetBrainKeys,
        );
        if (routingPolicy.mode !== "capture_only") {
          const controllingConfigurationDigest = slackPolicyConfigurationDigest(
            {
              organizationKey: input.organizationKey,
              channelKey: routingPolicy.channelKey,
              connectionKey: routingPolicy.connectionKey,
              connectionGeneration: routingPolicy.connectionGeneration,
              policyEpoch: routingPolicy.policyEpoch,
              mode: routingPolicy.mode,
              targetBrainKeys: routingPolicy.targetBrainKeys,
            },
          );
          for (const target of workspaces.filter(
            (workspace) =>
              workspace.status === "active" &&
              workspace.brainKey !== undefined &&
              currentTargets.has(workspace.brainKey),
          ))
            yield* ensureSlackRequiredScopeForPolicyEffect({
              reader,
              writer,
              organizationKey: input.organizationKey,
              workspaceId: target._id,
              brainKey: target.brainKey ?? "",
              channelKey: routingPolicy.channelKey,
              connectionKey: routingPolicy.connectionKey,
              connectionGeneration: routingPolicy.connectionGeneration,
              policyEpoch: routingPolicy.policyEpoch,
              controllingConfigurationDigest,
              now,
            });
        }
        for (const removedBrainKey of [...priorTargets].filter(
          (brainKey) => !currentTargets.has(brainKey),
        )) {
          const target = workspaces.find(
            (workspace) => workspace.brainKey === removedBrainKey,
          );
          if (target !== undefined)
            yield* decommissionSlackRequiredScopeForPolicyEffect({
              reader,
              writer,
              workspaceId: target._id,
              brainKey: removedBrainKey,
              channelKey: routingPolicy.channelKey,
              now,
            });
        }
        for (const targetBrainKey of new Set([
          ...priorTargets,
          ...currentTargets,
        ]))
          yield* transitionEligibilityFenceEffect({
            identity: slackPolicyFenceIdentity({
              organizationKey: input.organizationKey,
              channelKey: routingPolicy.channelKey,
              brainKey: targetBrainKey,
            }),
            eligible: currentTargets.has(targetBrainKey),
            now,
          });
        const targetBrainKeys = new Set([
          ...(priorActiveRouting.get(routingPolicy.channelKey)
            ?.targetBrainKeys ?? []),
          ...routingPolicy.targetBrainKeys,
        ]);
        for (const target of workspaces.filter(
          (workspace) =>
            workspace.status === "active" &&
            workspace.brainKey !== undefined &&
            targetBrainKeys.has(workspace.brainKey),
        ))
          yield* enqueueRetrievalPublicationJobEffect(
            {
              organizationKey: input.organizationKey,
              workspaceId: target._id,
              brainKey: target.brainKey ?? "",
              originKind: "slack_rebuild",
              sourceKey: routingPolicy.channelKey,
              sourceRevisionKey: `policy:${routingPolicy.channelKey}:${routingPolicy.policyEpoch}`,
              requestGeneration: routingPolicy.policyEpoch,
              rebuild: { limit: 5 },
            },
            now,
          );
      }
      const changedRoutingChannels = new Set(
        planned.right.routingPolicies.map(({ channelKey }) => channelKey),
      );
      for (const change of input.changes) {
        if (changedRoutingChannels.has(change.channelKey)) continue;
        const routingPolicy = priorActiveRouting.get(change.channelKey);
        if (
          routingPolicy === undefined ||
          routingPolicy.mode === "capture_only"
        )
          continue;
        const controllingConfigurationDigest = slackPolicyConfigurationDigest({
          organizationKey: input.organizationKey,
          channelKey: routingPolicy.channelKey,
          connectionKey: routingPolicy.connectionKey,
          connectionGeneration: routingPolicy.connectionGeneration,
          policyEpoch: routingPolicy.policyEpoch,
          mode: routingPolicy.mode,
          targetBrainKeys: routingPolicy.targetBrainKeys,
        });
        for (const target of workspaces.filter(
          (workspace) =>
            workspace.status === "active" &&
            workspace.brainKey !== undefined &&
            routingPolicy.targetBrainKeys.includes(workspace.brainKey),
        ))
          yield* ensureSlackRequiredScopeForPolicyEffect({
            reader,
            writer,
            organizationKey: input.organizationKey,
            workspaceId: target._id,
            brainKey: target.brainKey ?? "",
            channelKey: routingPolicy.channelKey,
            connectionKey: routingPolicy.connectionKey,
            connectionGeneration: routingPolicy.connectionGeneration,
            policyEpoch: routingPolicy.policyEpoch,
            controllingConfigurationDigest,
            now,
          });
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
