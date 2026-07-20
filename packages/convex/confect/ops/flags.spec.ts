import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Id } from "../_generated/id";
import {
  Forbidden,
  MemberNotInWorkspace,
  Unauthorized,
  ValidationFailed,
  WorkspaceNotFound,
} from "../errors";
import {
  FeatureFlagAudience,
  FeatureFlagKey,
} from "../tables/featureFlagPolicies";

export const BrainOperationLaunchFlagKey = Schema.Literal(
  "template.brain.semanticOperations",
  "template.brain.externalDelivery",
);

const NonEmptyString = Schema.String.pipe(Schema.minLength(1));
const FlagError = Schema.Union(
  Unauthorized,
  Forbidden,
  MemberNotInWorkspace,
  WorkspaceNotFound,
  ValidationFailed,
);

export const ListFeatureFlagsArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
});

export const EvaluateFeatureFlagsArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
});

export const UpsertFeatureFlagPolicyArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  key: FeatureFlagKey,
  description: NonEmptyString,
  enabled: Schema.Boolean,
  rolloutPercent: Schema.Number.pipe(
    Schema.int(),
    Schema.greaterThanOrEqualTo(0),
    Schema.lessThanOrEqualTo(100),
  ),
  audience: FeatureFlagAudience,
  killSwitchEnv: Schema.optional(NonEmptyString),
});

export const FeatureFlagPolicyReturn = Schema.Struct({
  workspaceId: Id("workspaces"),
  key: FeatureFlagKey,
  description: Schema.String,
  enabled: Schema.Boolean,
  rolloutPercent: Schema.Number,
  audience: FeatureFlagAudience,
  killSwitchEnv: Schema.optional(Schema.String),
  source: Schema.Literal("default", "workspace"),
  updatedAt: Schema.Number,
});

export const FeatureFlagDecisionReturn = Schema.Struct({
  workspaceId: Id("workspaces"),
  key: FeatureFlagKey,
  enabled: Schema.Boolean,
  reason: Schema.Literal(
    "enabled",
    "definition-disabled",
    "audience",
    "rollout",
  ),
  rolloutBucket: Schema.Number,
  source: Schema.Literal("default", "workspace"),
});

export const FeatureFlagListReturn = Schema.Struct({
  policies: Schema.Array(FeatureFlagPolicyReturn),
});

export const FeatureFlagEvaluationReturn = Schema.Struct({
  decisions: Schema.Array(FeatureFlagDecisionReturn),
  summary: Schema.Struct({
    total: Schema.Number,
    enabled: Schema.Number,
    disabled: Schema.Number,
  }),
});

const list = FunctionSpec.publicQuery({
  name: "list",
  args: () => ListFeatureFlagsArgs,
  returns: () => FeatureFlagListReturn,
  error: () => FlagError,
});

const evaluate = FunctionSpec.publicQuery({
  name: "evaluate",
  args: () => EvaluateFeatureFlagsArgs,
  returns: () => FeatureFlagEvaluationReturn,
  error: () => FlagError,
});

const upsertPolicyInternal = FunctionSpec.internalMutation({
  name: "upsertPolicyInternal",
  args: () => UpsertFeatureFlagPolicyArgs,
  returns: () => FeatureFlagPolicyReturn,
  error: () => Schema.Union(ValidationFailed),
});

export default GroupSpec.make()
  .addFunction(list)
  .addFunction(evaluate)
  .addFunction(upsertPolicyInternal);
