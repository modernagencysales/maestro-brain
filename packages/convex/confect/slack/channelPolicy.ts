import * as Either from "effect/Either";
import * as Schema from "effect/Schema";

import type { SourceChannelRowValue } from "../tables/sourceChannels";
import type { ChannelDeliveryPolicyRowValue } from "../tables/channelDeliveryPolicies";
import type { ChannelRoutingPolicyRowValue } from "../tables/channelRoutingPolicies";

export class ChannelNotJoined extends Schema.TaggedError<ChannelNotJoined>()(
  "ChannelNotJoined",
  { channelKey: Schema.String },
) {}

export class PolicyInvalid extends Schema.TaggedError<PolicyInvalid>()(
  "PolicyInvalid",
  { reason: Schema.String },
) {}

export class TargetBrainForbidden extends Schema.TaggedError<TargetBrainForbidden>()(
  "TargetBrainForbidden",
  { brainKey: Schema.String },
) {}

export class PolicyGenerationMismatch extends Schema.TaggedError<PolicyGenerationMismatch>()(
  "PolicyGenerationMismatch",
  { channelKey: Schema.String },
) {}

export class CapacityExceeded extends Schema.TaggedError<CapacityExceeded>()(
  "CapacityExceeded",
  { limit: Schema.Number, actual: Schema.Number, kind: Schema.String },
) {}

type ChannelPolicyError =
  | ChannelNotJoined
  | PolicyInvalid
  | TargetBrainForbidden
  | PolicyGenerationMismatch
  | CapacityExceeded;

type BulkPolicyPlan = {
  readonly routingPolicies: readonly ChannelRoutingPolicyRowValue[];
  readonly deliveryPolicies: readonly ChannelDeliveryPolicyRowValue[];
  readonly auditRows: readonly {
    readonly organizationKey: string;
    readonly actorRole: "admin" | "owner";
    readonly action: "channel_policy_bulk_update";
    readonly targetCount: number;
    readonly recordedAt: number;
  }[];
};

export type BrainTarget = {
  readonly brainKey: string;
  readonly name: string;
  readonly organizationKey: string;
  readonly kind: "client" | "agency";
  readonly status: "active" | string;
};

export type RoutingChange = {
  readonly mode: "direct" | "classify" | "capture_only";
  readonly targetBrainKeys: readonly string[];
};

export type DeliveryChange = {
  readonly mode: "requester_private" | "capture_only";
};

export type ChannelPolicyChange = {
  readonly channelKey: string;
  readonly routing: RoutingChange;
  readonly delivery: DeliveryChange;
};

export type BulkPolicyRequest = {
  readonly organizationKey: string;
  readonly actorRole: "viewer" | "editor" | "admin" | "owner";
  readonly expectedConnectionGeneration: number;
  readonly expectedChannelAccessGeneration: number;
  readonly now: number;
  readonly channels: readonly SourceChannelRowValue[];
  readonly existingRoutingPolicies: readonly ChannelRoutingPolicyRowValue[];
  readonly existingDeliveryPolicies: readonly ChannelDeliveryPolicyRowValue[];
  readonly allowedBrainTargets: readonly BrainTarget[];
  readonly changes: readonly ChannelPolicyChange[];
};

const CHANNEL_LIMIT = 100;
const CLIENT_BRAIN_LIMIT = 25;

const nextEpoch = (
  policies: readonly {
    readonly channelKey: string;
    readonly policyEpoch?: number;
    readonly deliveryGeneration?: number;
  }[],
  channelKey: string,
  key: "policyEpoch" | "deliveryGeneration",
) =>
  Math.max(
    0,
    ...policies
      .filter((policy) => policy.channelKey === channelKey)
      .map((policy) => policy[key] ?? 0),
  ) + 1;

const unique = (values: readonly string[]) =>
  new Set(values).size === values.length;

const activeRoutingMatches = (
  policy: ChannelRoutingPolicyRowValue | undefined,
  change: RoutingChange,
) =>
  policy?.active === true &&
  policy.mode === change.mode &&
  policy.targetBrainKeys.length === change.targetBrainKeys.length &&
  policy.targetBrainKeys.every(
    (brainKey, index) => brainKey === change.targetBrainKeys[index],
  );

const activeDeliveryMatches = (
  policy: ChannelDeliveryPolicyRowValue | undefined,
  change: DeliveryChange,
) => policy?.active === true && policy.mode === change.mode;

const activeRoutingPolicyFor = (
  policies: readonly ChannelRoutingPolicyRowValue[],
  channelKey: string,
) =>
  policies.find((policy) => policy.channelKey === channelKey && policy.active);

const activeDeliveryPolicyFor = (
  policies: readonly ChannelDeliveryPolicyRowValue[],
  channelKey: string,
) =>
  policies.find((policy) => policy.channelKey === channelKey && policy.active);

const validateRouting = (
  routing: RoutingChange,
  allowedTargets: ReadonlySet<string>,
): Either.Either<true, ChannelPolicyError> => {
  if (routing.mode === "direct" && routing.targetBrainKeys.length !== 1) {
    return Either.left(
      new PolicyInvalid({ reason: "direct_requires_one_target" }),
    );
  }
  if (routing.mode === "classify" && routing.targetBrainKeys.length === 0) {
    return Either.left(
      new PolicyInvalid({ reason: "classify_requires_targets" }),
    );
  }
  if (routing.mode === "capture_only" && routing.targetBrainKeys.length !== 0) {
    return Either.left(
      new PolicyInvalid({ reason: "capture_only_rejects_targets" }),
    );
  }
  if (!unique(routing.targetBrainKeys)) {
    return Either.left(new PolicyInvalid({ reason: "duplicate_targets" }));
  }
  for (const brainKey of routing.targetBrainKeys) {
    if (!allowedTargets.has(brainKey)) {
      return Either.left(new TargetBrainForbidden({ brainKey }));
    }
  }
  return Either.right(true);
};

export const buildBulkPolicyPlan = (
  request: BulkPolicyRequest,
): Either.Either<BulkPolicyPlan, ChannelPolicyError> => {
  if (request.actorRole !== "admin" && request.actorRole !== "owner") {
    return Either.left(new PolicyInvalid({ reason: "admin_required" }));
  }
  const activeChannels = request.channels.filter(
    (channel) =>
      channel.membershipStatus === "joined_needs_policy" ||
      channel.membershipStatus === "joined_active",
  );
  if (activeChannels.length > CHANNEL_LIMIT) {
    return Either.left(
      new CapacityExceeded({
        kind: "channels",
        limit: CHANNEL_LIMIT,
        actual: activeChannels.length,
      }),
    );
  }
  const allowedTargets = request.allowedBrainTargets.filter(
    (target) =>
      target.organizationKey === request.organizationKey &&
      target.kind === "client" &&
      target.status === "active",
  );
  if (allowedTargets.length > CLIENT_BRAIN_LIMIT) {
    return Either.left(
      new CapacityExceeded({
        kind: "client_brains",
        limit: CLIENT_BRAIN_LIMIT,
        actual: allowedTargets.length,
      }),
    );
  }
  const allowedTargetKeys = new Set(
    allowedTargets.map((target) => target.brainKey),
  );
  const channelsByKey = new Map(
    request.channels.map((channel) => [channel.channelKey, channel]),
  );
  const routingPolicies: ChannelRoutingPolicyRowValue[] = [];
  const deliveryPolicies: ChannelDeliveryPolicyRowValue[] = [];

  for (const change of request.changes) {
    const channel = channelsByKey.get(change.channelKey);
    if (
      !channel ||
      (channel.membershipStatus !== "joined_needs_policy" &&
        channel.membershipStatus !== "joined_active")
    ) {
      return Either.left(
        new ChannelNotJoined({ channelKey: change.channelKey }),
      );
    }
    if (
      channel.connectionGeneration !== request.expectedConnectionGeneration ||
      channel.accessGeneration !== request.expectedChannelAccessGeneration
    ) {
      return Either.left(
        new PolicyGenerationMismatch({ channelKey: change.channelKey }),
      );
    }
    const routingValid = validateRouting(change.routing, allowedTargetKeys);
    if (Either.isLeft(routingValid)) return Either.left(routingValid.left);
    if (
      (channel.isShared || channel.isExtShared) &&
      change.delivery.mode !== "capture_only"
    ) {
      return Either.left(
        new PolicyInvalid({ reason: "slack_connect_delivery_capture_only" }),
      );
    }
    const activeRoutingPolicy = activeRoutingPolicyFor(
      request.existingRoutingPolicies,
      channel.channelKey,
    );
    const activeDeliveryPolicy = activeDeliveryPolicyFor(
      request.existingDeliveryPolicies,
      channel.channelKey,
    );
    if (
      activeRoutingMatches(activeRoutingPolicy, change.routing) &&
      activeDeliveryMatches(activeDeliveryPolicy, change.delivery)
    ) {
      continue;
    }
    routingPolicies.push({
      organizationKey: request.organizationKey,
      connectionKey: channel.connectionKey,
      connectionGeneration: channel.connectionGeneration,
      channelKey: channel.channelKey,
      policyEpoch: nextEpoch(
        request.existingRoutingPolicies,
        channel.channelKey,
        "policyEpoch",
      ),
      active: true,
      mode: change.routing.mode,
      targetBrainKeys: [...change.routing.targetBrainKeys],
      statusAfterApply:
        change.routing.mode === "capture_only" ? "capture_only" : "streaming",
      pendingSourceInterval: {
        firstObservedAt: request.now,
        status: "pending",
      },
      createdByRole: request.actorRole,
      createdAt: request.now,
    });
    deliveryPolicies.push({
      organizationKey: request.organizationKey,
      channelKey: channel.channelKey,
      deliveryGeneration: nextEpoch(
        request.existingDeliveryPolicies,
        channel.channelKey,
        "deliveryGeneration",
      ),
      active: true,
      mode: change.delivery.mode,
      createdByRole: request.actorRole,
      createdAt: request.now,
    });
  }

  return Either.right({
    routingPolicies,
    deliveryPolicies,
    auditRows:
      routingPolicies.length === 0 && deliveryPolicies.length === 0
        ? []
        : [
            {
              organizationKey: request.organizationKey,
              actorRole: request.actorRole,
              action: "channel_policy_bulk_update",
              targetCount: request.changes.length,
              recordedAt: request.now,
            },
          ],
  });
};
