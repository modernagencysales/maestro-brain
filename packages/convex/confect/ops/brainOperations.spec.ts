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

export const BrainOperationSubsystem = Schema.Literal(
  "capture",
  "backfill",
  "classification",
  "maintenance",
  "ask",
  "slackDelivery",
  "mcp",
  "export",
  "lifecycle",
);

export const BrainOperationPolicyState = Schema.Literal(
  "enabled",
  "paused",
  "disabled",
);

export class OperatorForbidden extends Schema.TaggedError<OperatorForbidden>()(
  "OperatorForbidden",
  { reason: Schema.String },
) {}

export const BrainOperationBudget = Schema.Literal(
  "modelTokens",
  "modelSpendCents",
  "slackRate",
  "storageBytes",
  "queueDepth",
  "channelCount",
);

export class BudgetExceeded extends Schema.TaggedError<BudgetExceeded>()(
  "BudgetExceeded",
  { budget: Schema.String, limit: Schema.Number, observed: Schema.Number },
) {}

export class SubsystemDisabled extends Schema.TaggedError<SubsystemDisabled>()(
  "SubsystemDisabled",
  { subsystem: Schema.String },
) {}

export class RecoveryGenerationMismatch extends Schema.TaggedError<RecoveryGenerationMismatch>()(
  "RecoveryGenerationMismatch",
  { expectedGeneration: Schema.Number, actualGeneration: Schema.Number },
) {}

const OperationError = Schema.Union(
  OperatorForbidden,
  BudgetExceeded,
  SubsystemDisabled,
  RecoveryGenerationMismatch,
  Forbidden,
  MemberNotInWorkspace,
  Unauthorized,
  ValidationFailed,
  WorkspaceNotFound,
);

export const ListBrainOperationPoliciesArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
});

export const SetBrainOperationPolicyArgs = Schema.Struct({
  workspaceId: Id("workspaces"),
  subsystem: BrainOperationSubsystem,
  state: BrainOperationPolicyState,
  ownerUserId: Schema.String,
  reason: Schema.String.pipe(Schema.minLength(1)),
  idempotencyKey: Schema.String.pipe(Schema.minLength(1)),
  budgetCheck: Schema.optional(
    Schema.Struct({
      budget: BrainOperationBudget,
      limit: Schema.Number,
      observed: Schema.Number,
    }),
  ),
  expectedGeneration: Schema.optional(Schema.Number.pipe(Schema.int())),
  expiresAt: Schema.optional(Schema.Number.pipe(Schema.int())),
});

export const BrainOperationPolicyReturn = Schema.Struct({
  workspaceId: Id("workspaces"),
  subsystem: BrainOperationSubsystem,
  state: BrainOperationPolicyState,
  ownerUserId: Schema.String,
  reason: Schema.String,
  generation: Schema.Number,
  updatedAt: Schema.Number,
  expiresAt: Schema.optional(Schema.Number),
});

export const BrainOperationPolicyListReturn = Schema.Struct({
  policies: Schema.Array(BrainOperationPolicyReturn),
});

const listPolicies = FunctionSpec.publicQuery({
  name: "listPolicies",
  args: () => ListBrainOperationPoliciesArgs,
  returns: () => BrainOperationPolicyListReturn,
  error: () => OperationError,
});

const setPolicyInternal = FunctionSpec.internalMutation({
  name: "setPolicyInternal",
  args: () => SetBrainOperationPolicyArgs,
  returns: () => BrainOperationPolicyReturn,
  error: () => OperationError,
});

export default GroupSpec.make()
  .addFunction(listPolicies)
  .addFunction(setPolicyInternal);
