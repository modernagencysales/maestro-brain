import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Forbidden, Unauthorized } from "../errors";

export class ConnectionAlreadyExists extends Schema.TaggedError<ConnectionAlreadyExists>()(
  "ConnectionAlreadyExists",
  { organizationKey: Schema.String },
) {}

export class ConnectSessionInvalid extends Schema.TaggedError<ConnectSessionInvalid>()(
  "ConnectSessionInvalid",
  {},
) {}

export class ProviderUnavailable extends Schema.TaggedError<ProviderUnavailable>()(
  "ProviderUnavailable",
  {},
) {}

export class TenantMismatch extends Schema.TaggedError<TenantMismatch>()(
  "TenantMismatch",
  {},
) {}

const slackConnectError = () =>
  Schema.Union(
    Unauthorized,
    Forbidden,
    ConnectionAlreadyExists,
    ConnectSessionInvalid,
    ProviderUnavailable,
    TenantMismatch,
  );

export const PrepareSlackConnectAttemptArgs = Schema.Struct({
  now: Schema.Number,
});

export const ReserveSlackConnectAttemptArgs = Schema.Struct({
  connectSessionId: Schema.String,
  organizationKey: Schema.String,
  connectionKey: Schema.String,
  nangoEndUserId: Schema.String,
  nangoOrganizationId: Schema.String,
  providerConfigKey: Schema.Literal("slack"),
  correlationTag: Schema.String,
  attemptId: Schema.String,
  attemptExpiresAt: Schema.Number,
  now: Schema.Number,
});

export const ClaimSlackConnectAttemptArgs = Schema.Struct({
  connectSessionId: Schema.String,
  connectionId: Schema.String,
  providerOrganizationKey: Schema.String,
  providerEndUserId: Schema.String,
  providerConfigKey: Schema.String,
  correlationTag: Schema.String,
  now: Schema.Number,
});

export const AuthorizeSlackConnectCompletionArgs = Schema.Struct({
  connectSessionId: Schema.String,
  now: Schema.Number,
});

export const FinalizeSlackConnectAttemptArgs = Schema.Struct({
  connectSessionId: Schema.String,
  connectionId: Schema.String,
  now: Schema.Number,
});

const connectResult = () =>
  Schema.Struct({
    connectionKey: Schema.String,
    status: Schema.Literal("verifying", "error"),
  });

const beginSlackConnect = FunctionSpec.publicAction({
  name: "beginSlackConnect",
  args: () => Schema.Struct({}),
  returns: () =>
    Schema.Struct({
      connectSessionId: Schema.String,
      connectSessionToken: Schema.String,
      expiresAt: Schema.Number,
    }),
  error: slackConnectError,
});

const completeSlackConnect = FunctionSpec.publicAction({
  name: "completeSlackConnect",
  args: () =>
    Schema.Struct({
      connectionId: Schema.String,
      connectSessionId: Schema.String,
    }),
  returns: connectResult,
  error: slackConnectError,
});

const prepareSlackConnectAttempt = FunctionSpec.internalMutation({
  name: "prepareSlackConnectAttempt",
  args: () => PrepareSlackConnectAttemptArgs,
  returns: () =>
    Schema.Struct({
      organizationKey: Schema.String,
      connectionKey: Schema.String,
      nangoEndUserId: Schema.String,
      nangoOrganizationId: Schema.String,
      providerConfigKey: Schema.Literal("slack"),
      correlationTag: Schema.String,
      attemptId: Schema.String,
      connectSessionId: Schema.String,
    }),
  error: slackConnectError,
});

const reserveSlackConnectAttempt = FunctionSpec.internalMutation({
  name: "reserveSlackConnectAttempt",
  args: () => ReserveSlackConnectAttemptArgs,
  returns: () => Schema.Struct({ connectionKey: Schema.String }),
  error: slackConnectError,
});

const claimSlackConnectAttempt = FunctionSpec.internalMutation({
  name: "claimSlackConnectAttempt",
  args: () => ClaimSlackConnectAttemptArgs,
  returns: connectResult,
  error: slackConnectError,
});

const authorizeSlackConnectCompletion = FunctionSpec.internalMutation({
  name: "authorizeSlackConnectCompletion",
  args: () => AuthorizeSlackConnectCompletionArgs,
  returns: () => Schema.Struct({ organizationKey: Schema.String }),
  error: slackConnectError,
});

const finalizeSlackConnectAttempt = FunctionSpec.internalMutation({
  name: "finalizeSlackConnectAttempt",
  args: () => FinalizeSlackConnectAttemptArgs,
  returns: connectResult,
  error: slackConnectError,
});

export default GroupSpec.make()
  .addFunction(beginSlackConnect)
  .addFunction(completeSlackConnect)
  .addFunction(prepareSlackConnectAttempt)
  .addFunction(reserveSlackConnectAttempt)
  .addFunction(claimSlackConnectAttempt)
  .addFunction(authorizeSlackConnectCompletion)
  .addFunction(finalizeSlackConnectAttempt);
