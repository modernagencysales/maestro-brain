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
