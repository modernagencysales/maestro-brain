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
  nonce: Schema.String,
  attemptExpiresAt: Schema.Number,
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
  connectionId: Schema.String,
  now: Schema.Number,
});

export const MarkSlackConnectAttemptFailedArgs = Schema.Struct({
  connectSessionId: Schema.String,
  expectedConnectionGeneration: Schema.Number,
  now: Schema.Number,
});

export const ReconcileSlackConnectSessionExpiryArgs = Schema.Struct({
  connectSessionId: Schema.String,
  attemptId: Schema.String,
  expectedConnectionGeneration: Schema.Number,
  providerExpiresAt: Schema.Number,
  localMaxExpiresAt: Schema.Number,
  now: Schema.Number,
});

export const FinalizeSlackConnectAttemptArgs = Schema.Struct({
  connectSessionId: Schema.String,
  connectionId: Schema.String,
  expectedConnectionGeneration: Schema.Number,
  now: Schema.Number,
});

const connectResult = () =>
  Schema.Struct({
    connectionKey: Schema.String,
    status: Schema.Literal("verifying", "error"),
  });

export const beginSlackConnect = FunctionSpec.publicAction({
  name: "beginSlackConnect",
  args: () => Schema.Struct({}),
  returns: () =>
    Schema.Struct({
      connectSessionId: Schema.String,
      connectSessionToken: Schema.String,
      expiresAt: Schema.Number,
    }),
  error: () => slackConnectError(),
});

export const completeSlackConnect = FunctionSpec.publicAction({
  name: "completeSlackConnect",
  args: () =>
    Schema.Struct({
      connectionId: Schema.String,
      connectSessionId: Schema.String,
    }),
  returns: () =>
    Schema.Struct({
      connectionKey: Schema.String,
      status: Schema.Literal("verifying", "error"),
      connectionGeneration: Schema.Number,
    }),
  error: () => slackConnectError(),
});

export const prepareSlackConnectAttempt = FunctionSpec.internalMutation({
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
      connectionGeneration: Schema.Number,
    }),
  error: () => slackConnectError(),
});

export const claimSlackConnectAttempt = FunctionSpec.internalMutation({
  name: "claimSlackConnectAttempt",
  args: () => ClaimSlackConnectAttemptArgs,
  returns: () => connectResult(),
  error: () => slackConnectError(),
});

export const authorizeSlackConnectCompletion = FunctionSpec.internalMutation({
  name: "authorizeSlackConnectCompletion",
  args: () => AuthorizeSlackConnectCompletionArgs,
  returns: () =>
    Schema.Struct({
      organizationKey: Schema.String,
      connectionGeneration: Schema.Number,
      nangoOrganizationId: Schema.String,
      nangoEndUserId: Schema.String,
      providerConfigKey: Schema.Literal("slack"),
      correlationTag: Schema.String,
      alreadyCompleted: Schema.Boolean,
      connectionKey: Schema.String,
      status: Schema.Literal("verifying"),
    }),
  error: () => slackConnectError(),
});

export const markSlackConnectAttemptFailed = FunctionSpec.internalMutation({
  name: "markSlackConnectAttemptFailed",
  args: () => MarkSlackConnectAttemptFailedArgs,
  returns: () =>
    Schema.Struct({
      connectionKey: Schema.String,
      status: Schema.Literal("error"),
    }),
  error: () => slackConnectError(),
});

export const reconcileSlackConnectSessionExpiry = FunctionSpec.internalMutation(
  {
    name: "reconcileSlackConnectSessionExpiry",
    args: () => ReconcileSlackConnectSessionExpiryArgs,
    returns: () =>
      Schema.Struct({
        connectionKey: Schema.String,
        attemptExpiresAt: Schema.Number,
      }),
    error: () => slackConnectError(),
  },
);

export const finalizeSlackConnectAttempt = FunctionSpec.internalMutation({
  name: "finalizeSlackConnectAttempt",
  args: () => FinalizeSlackConnectAttemptArgs,
  returns: () => connectResult(),
  error: () => slackConnectError(),
});

export default GroupSpec.make()
  .addFunction(beginSlackConnect)
  .addFunction(completeSlackConnect)
  .addFunction(prepareSlackConnectAttempt)
  .addFunction(claimSlackConnectAttempt)
  .addFunction(authorizeSlackConnectCompletion)
  .addFunction(markSlackConnectAttemptFailed)
  .addFunction(reconcileSlackConnectSessionExpiry)
  .addFunction(finalizeSlackConnectAttempt);
