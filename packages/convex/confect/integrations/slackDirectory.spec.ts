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

const slackDirectoryError = () =>
  Schema.Union(
    ConnectionNotFound,
    ConnectionGenerationMismatch,
    BotIdentityMismatch,
    ProviderRateLimited,
    ProviderUnavailable,
  );

export const reconcileChannels = FunctionSpec.internalMutation({
  name: "reconcileChannels",
  args: () =>
    Schema.Struct({
      connectionKey: Schema.String,
      expectedGeneration: Schema.Number,
      cursor: Schema.NullOr(Schema.String),
      limit: Schema.Number,
    }),
  returns: () =>
    Schema.Struct({
      upserted: Schema.Number,
      accessGained: Schema.Number,
      accessLost: Schema.Number,
      nextCursor: Schema.NullOr(Schema.String),
    }),
  error: () => slackDirectoryError(),
});

export default GroupSpec.make().addFunction(reconcileChannels);
