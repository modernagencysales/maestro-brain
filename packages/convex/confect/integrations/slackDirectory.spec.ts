import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

export class ConnectionNotFound extends Schema.TaggedError<ConnectionNotFound>()(
  "ConnectionNotFound",
  { connectionKey: Schema.String },
) {}

export class ConnectionGenerationMismatch extends Schema.TaggedError<ConnectionGenerationMismatch>()(
  "ConnectionGenerationMismatch",
  {
    connectionKey: Schema.String,
    expectedGeneration: Schema.Number,
    actualGeneration: Schema.Number,
  },
) {}

export class BotIdentityMismatch extends Schema.TaggedError<BotIdentityMismatch>()(
  "BotIdentityMismatch",
  { connectionKey: Schema.String },
) {}

export class ProviderRateLimited extends Schema.TaggedError<ProviderRateLimited>()(
  "ProviderRateLimited",
  { retryAfterMs: Schema.optional(Schema.Number) },
) {}

export class ProviderUnavailable extends Schema.TaggedError<ProviderUnavailable>()(
  "ProviderUnavailable",
  {},
) {}

const SlackBotIdentity = Schema.Struct({
  teamId: Schema.String,
  apiAppId: Schema.String,
  botUserId: Schema.String,
});

const ProviderSlackChannel = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  is_member: Schema.Boolean,
  is_shared: Schema.optional(Schema.Boolean),
  is_ext_shared: Schema.optional(Schema.Boolean),
  is_archived: Schema.optional(Schema.Boolean),
});

const ReconcileResult = Schema.Struct({
  upserted: Schema.Number,
  accessGained: Schema.Number,
  accessLost: Schema.Number,
  nextCursor: Schema.NullOr(Schema.String),
});

const ConnectionSnapshot = Schema.Struct({
  organizationKey: Schema.String,
  connectionKey: Schema.String,
  connectionGeneration: Schema.Number,
  status: Schema.String,
  teamId: Schema.optional(Schema.NullOr(Schema.String)),
  apiAppId: Schema.optional(Schema.NullOr(Schema.String)),
  botUserId: Schema.optional(Schema.NullOr(Schema.String)),
  nangoConnectionId: Schema.optional(Schema.NullOr(Schema.String)),
});

const CommitIdentityResult = Schema.Union(
  Schema.Struct({
    kind: Schema.Literal("ok"),
    connectionGeneration: Schema.Number,
  }),
  Schema.Struct({ kind: Schema.Literal("bot_identity_mismatch") }),
);

const slackDirectoryError = () =>
  Schema.Union(
    ConnectionNotFound,
    ConnectionGenerationMismatch,
    BotIdentityMismatch,
    ProviderRateLimited,
    ProviderUnavailable,
  );

export const reconcileChannels = FunctionSpec.internalAction({
  name: "reconcileChannels",
  args: () =>
    Schema.Struct({
      connectionKey: Schema.String,
      expectedGeneration: Schema.Number,
      cursor: Schema.NullOr(Schema.String),
      limit: Schema.Number,
    }),
  returns: () => ReconcileResult,
  error: () => slackDirectoryError(),
});

export const readReconcileConnection = FunctionSpec.internalQuery({
  name: "readReconcileConnection",
  args: () =>
    Schema.Struct({
      connectionKey: Schema.String,
      expectedGeneration: Schema.Number,
    }),
  returns: () => ConnectionSnapshot,
  error: () => slackDirectoryError(),
});

export const commitReconcileIdentity = FunctionSpec.internalMutation({
  name: "commitReconcileIdentity",
  args: () =>
    Schema.Struct({
      connectionKey: Schema.String,
      expectedGeneration: Schema.Number,
      providerIdentity: SlackBotIdentity,
    }),
  returns: () => CommitIdentityResult,
  error: () => slackDirectoryError(),
});

export const commitInitialReconcileFailure = FunctionSpec.internalMutation({
  name: "commitInitialReconcileFailure",
  args: () =>
    Schema.Struct({
      connectionKey: Schema.String,
      expectedGeneration: Schema.Number,
    }),
  returns: () => ReconcileResult,
  error: () => slackDirectoryError(),
});

export const commitReconcileChannels = FunctionSpec.internalMutation({
  name: "commitReconcileChannels",
  args: () =>
    Schema.Struct({
      connectionKey: Schema.String,
      expectedGeneration: Schema.Number,
      providerIdentity: SlackBotIdentity,
      cursor: Schema.NullOr(Schema.String),
      limit: Schema.Number,
      providerChannels: Schema.Array(ProviderSlackChannel),
      providerNextCursor: Schema.NullOr(Schema.String),
    }),
  returns: () => ReconcileResult,
  error: () => slackDirectoryError(),
});

export default GroupSpec.make()
  .addFunction(reconcileChannels)
  .addFunction(readReconcileConnection)
  .addFunction(commitReconcileIdentity)
  .addFunction(commitInitialReconcileFailure)
  .addFunction(commitReconcileChannels);
