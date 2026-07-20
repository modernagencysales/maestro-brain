import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import {
  CapacityExceeded,
  ChannelNotJoined,
  PolicyGenerationMismatch,
  PolicyInvalid,
  TargetBrainForbidden,
} from "./channelPolicy";

const RoutingChange = Schema.Struct({
  mode: Schema.Literal("direct", "classify", "capture_only"),
  targetBrainKeys: Schema.Array(Schema.String),
});

const DeliveryChange = Schema.Struct({
  mode: Schema.Literal("requester_private", "capture_only"),
});

const PolicyChange = Schema.Struct({
  channelKey: Schema.String,
  expectedRoutingPolicyEpoch: Schema.optional(Schema.Number),
  expectedDeliveryGeneration: Schema.optional(Schema.Number),
  routing: RoutingChange,
  delivery: DeliveryChange,
});

const ChannelPolicyReadModel = Schema.Struct({
  channels: Schema.Array(
    Schema.Struct({
      organizationKey: Schema.String,
      channelKey: Schema.String,
      name: Schema.String,
      membershipStatus: Schema.String,
      isShared: Schema.Boolean,
      isExtShared: Schema.Boolean,
      connectionGeneration: Schema.Number,
      accessGeneration: Schema.Number,
      activeRoutingPolicy: Schema.optional(
        Schema.Struct({
          policyEpoch: Schema.Number,
          statusAfterApply: Schema.Literal(
            "needs_policy",
            "streaming",
            "capture_only",
            "access_lost",
            "error",
          ),
        }),
      ),
      activeDeliveryPolicy: Schema.optional(
        Schema.Struct({ deliveryGeneration: Schema.Number }),
      ),
    }),
  ),
  clientBrains: Schema.Array(
    Schema.Struct({
      organizationKey: Schema.String,
      brainKey: Schema.String,
      kind: Schema.String,
      status: Schema.String,
    }),
  ),
});

const PolicyResult = Schema.Struct({
  applied: Schema.Number,
  auditAction: Schema.Literal("channel_policy_bulk_update"),
});

const DenialAuditArgs = Schema.Struct({
  organizationKey: Schema.String,
  reason: Schema.String,
});

const channelPolicyError = () =>
  Schema.Union(
    ChannelNotJoined,
    PolicyInvalid,
    TargetBrainForbidden,
    PolicyGenerationMismatch,
    CapacityExceeded,
  );

export const recordDenialAudit = FunctionSpec.internalMutation({
  name: "recordDenialAudit",
  args: () => DenialAuditArgs,
  returns: () => Schema.Null,
  error: () => PolicyInvalid,
});

export const getChannelPolicyReadModel = FunctionSpec.publicQuery({
  name: "getChannelPolicyReadModel",
  args: () => Schema.Struct({ organizationKey: Schema.String }),
  returns: () => ChannelPolicyReadModel,
  error: () => PolicyInvalid,
});

export const bulkSetChannelPolicies = FunctionSpec.publicMutation({
  name: "bulkSetChannelPolicies",
  args: () =>
    Schema.Struct({
      organizationKey: Schema.String,
      expectedConnectionGeneration: Schema.Number,
      expectedChannelAccessGeneration: Schema.Number,
      changes: Schema.Array(PolicyChange),
    }),
  returns: () => PolicyResult,
  error: () => channelPolicyError(),
});

export default GroupSpec.make()
  .addFunction(recordDenialAudit)
  .addFunction(getChannelPolicyReadModel)
  .addFunction(bulkSetChannelPolicies);
