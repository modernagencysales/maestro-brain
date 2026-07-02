import { FunctionSpec, GroupSpec } from "@confect/core";
import * as S from "effect/Schema";

export const SourceGroundedBriefArgs = S.Struct({
  workspaceId: S.String,
  sourceIds: S.Array(S.String).pipe(S.minItems(1)),
  briefGoal: S.String.pipe(S.minLength(1)),
  idempotencyKey: S.String.pipe(S.minLength(1)),
});

export const SourceGroundedBriefReturn = S.Struct({
  briefMarkdown: S.String,
  sourceTitles: S.Array(S.String),
  policySnapshotId: S.String,
  modelReceiptId: S.String,
  trustClaim: S.String,
});

export namespace SourceGroundedBriefError {
  export class Unauthenticated extends S.TaggedError<Unauthenticated>()(
    "Unauthenticated",
    {},
  ) {}

  export class NoWorkspaceAccess extends S.TaggedError<NoWorkspaceAccess>()(
    "NoWorkspaceAccess",
    {
      workspaceId: S.String,
    },
  ) {}

  export class ValidationFailed extends S.TaggedError<ValidationFailed>()(
    "ValidationFailed",
    {
      field: S.String,
      message: S.String,
    },
  ) {}

  export class PolicyNotFound extends S.TaggedError<PolicyNotFound>()(
    "PolicyNotFound",
    {
      kind: S.String,
      workspaceId: S.String,
    },
  ) {}

  export class PromptNotFound extends S.TaggedError<PromptNotFound>()(
    "PromptNotFound",
    {
      promptRef: S.String,
    },
  ) {}

  export class LlmDisabled extends S.TaggedError<LlmDisabled>()(
    "LlmDisabled",
    {},
  ) {}

  export class RateLimited extends S.TaggedError<RateLimited>()("RateLimited", {
    retryAfterMs: S.Number,
  }) {}

  export class SpendCapExceeded extends S.TaggedError<SpendCapExceeded>()(
    "SpendCapExceeded",
    {
      dailySpendLimitCents: S.Number,
    },
  ) {}

  export class ProviderConfigInvalid extends S.TaggedError<ProviderConfigInvalid>()(
    "ProviderConfigInvalid",
    {
      provider: S.String,
    },
  ) {}

  export const Schema = S.Union(
    Unauthenticated,
    NoWorkspaceAccess,
    ValidationFailed,
    PolicyNotFound,
    PromptNotFound,
    LlmDisabled,
    RateLimited,
    SpendCapExceeded,
    ProviderConfigInvalid,
  );
}

const run = FunctionSpec.publicMutation({
  name: "run",
  args: () => SourceGroundedBriefArgs,
  returns: () => SourceGroundedBriefReturn,
  error: () => SourceGroundedBriefError.Schema,
});

export default GroupSpec.make().addFunction(run);
