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
  routing: RoutingChange,
  delivery: DeliveryChange,
});

const PolicyResult = Schema.Struct({
  applied: Schema.Number,
  auditAction: Schema.Literal("channel_policy_bulk_update"),
});

const channelPolicyError = () =>
  Schema.Union(
    ChannelNotJoined,
    PolicyInvalid,
    TargetBrainForbidden,
    PolicyGenerationMismatch,
    CapacityExceeded,
  );

export const bulkSetChannelPolicies = FunctionSpec.internalMutation({
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

export default GroupSpec.make().addFunction(bulkSetChannelPolicies);
