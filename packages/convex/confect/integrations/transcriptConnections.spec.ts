import { FunctionSpec, GroupSpec } from "@confect/core";
import * as Schema from "effect/Schema";

import { Forbidden, Unauthorized } from "../errors";
import {
  ConnectSessionInvalid,
  ConnectionAlreadyExists,
  ProviderUnavailable,
  TenantMismatch,
} from "./slackConnections.spec";

export {
  ConnectSessionInvalid,
  ConnectionAlreadyExists,
  ProviderUnavailable,
  TenantMismatch,
} from "./slackConnections.spec";

export class UnsupportedTranscriptProvider extends Schema.TaggedError<UnsupportedTranscriptProvider>()(
  "UnsupportedTranscriptProvider",
  {},
) {}
export class TranscriptConnectionNotFound extends Schema.TaggedError<TranscriptConnectionNotFound>()(
  "TranscriptConnectionNotFound",
  {},
) {}
export class TranscriptPurgeNotReady extends Schema.TaggedError<TranscriptPurgeNotReady>()(
  "TranscriptPurgeNotReady",
  {},
) {}

export const TranscriptProvider = Schema.Literal(
  "fireflies",
  "gong",
  "fathom",
  "granola",
);

const connectionError = () =>
  Schema.Union(
    Unauthorized,
    Forbidden,
    UnsupportedTranscriptProvider,
    ConnectionAlreadyExists,
    ConnectSessionInvalid,
    ProviderUnavailable,
    TenantMismatch,
    TranscriptConnectionNotFound,
    TranscriptPurgeNotReady,
  );

const connectResult = () =>
  Schema.Struct({
    connectionKey: Schema.String,
    status: Schema.Literal("verifying", "error"),
    connectionGeneration: Schema.Number,
  });

export const beginTranscriptConnect = FunctionSpec.publicAction({
  name: "beginTranscriptConnect",
  args: () => Schema.Struct({ provider: TranscriptProvider }),
  returns: () =>
    Schema.Struct({
      connectSessionId: Schema.String,
      connectSessionToken: Schema.String,
      expiresAt: Schema.Number,
    }),
  error: () => connectionError(),
});

export const completeTranscriptConnect = FunctionSpec.publicAction({
  name: "completeTranscriptConnect",
  args: () =>
    Schema.Struct({
      provider: TranscriptProvider,
      connectSessionId: Schema.String,
      connectionId: Schema.String,
    }),
  returns: () => connectResult(),
  error: () => connectionError(),
});

const disconnectResult = () =>
  Schema.Struct({
    connectionKey: Schema.String,
    status: Schema.Literal("revoked"),
    connectionGeneration: Schema.Number,
  });

export const disconnectTranscriptConnection = FunctionSpec.publicAction({
  name: "disconnectTranscriptConnection",
  args: () => Schema.Struct({ provider: TranscriptProvider }),
  returns: () => disconnectResult(),
  error: () => connectionError(),
});

export const revokeTranscriptConnection = FunctionSpec.internalMutation({
  name: "revokeTranscriptConnection",
  args: () =>
    Schema.Struct({
      provider: TranscriptProvider,
      now: Schema.Number,
    }),
  returns: () =>
    Schema.Struct({
      connectionKey: Schema.String,
      connectionGeneration: Schema.Number,
      providerConfigKey: Schema.String,
      nangoConnectionId: Schema.NullOr(Schema.String),
    }),
  error: () => connectionError(),
});

export const finalizeTranscriptDisconnect = FunctionSpec.internalMutation({
  name: "finalizeTranscriptDisconnect",
  args: () =>
    Schema.Struct({
      provider: TranscriptProvider,
      connectionKey: Schema.String,
      expectedConnectionGeneration: Schema.Number,
      expectedNangoConnectionId: Schema.String,
      now: Schema.Number,
    }),
  returns: () => disconnectResult(),
  error: () => connectionError(),
});

export const requestTranscriptPurge = FunctionSpec.publicMutation({
  name: "requestTranscriptPurge",
  args: () => Schema.Struct({ provider: TranscriptProvider }),
  returns: () =>
    Schema.Struct({
      requestKey: Schema.String,
      status: Schema.Literal("pending_review"),
      physicalDeletion: Schema.Literal(false),
    }),
  error: () => connectionError(),
});

export const prepareTranscriptConnectAttempt = FunctionSpec.internalMutation({
  name: "prepareTranscriptConnectAttempt",
  args: () =>
    Schema.Struct({
      provider: TranscriptProvider,
      nonce: Schema.String,
      attemptExpiresAt: Schema.Number,
      now: Schema.Number,
    }),
  returns: () =>
    Schema.Struct({
      organizationKey: Schema.String,
      connectionKey: Schema.String,
      connectionGeneration: Schema.Number,
      providerConfigKey: Schema.String,
      connectSessionId: Schema.String,
      nangoEndUserId: Schema.String,
      nangoOrganizationId: Schema.String,
      correlationTag: Schema.String,
    }),
  error: () => connectionError(),
});

export const authorizeTranscriptConnectCompletion =
  FunctionSpec.internalMutation({
    name: "authorizeTranscriptConnectCompletion",
    args: () =>
      Schema.Struct({
        provider: TranscriptProvider,
        connectSessionId: Schema.String,
        connectionId: Schema.String,
        now: Schema.Number,
      }),
    returns: () =>
      Schema.Struct({
        connectionKey: Schema.String,
        connectionGeneration: Schema.Number,
        providerConfigKey: Schema.String,
        nangoEndUserId: Schema.String,
        nangoOrganizationId: Schema.String,
        correlationTag: Schema.String,
        alreadyCompleted: Schema.Boolean,
      }),
    error: () => connectionError(),
  });

export const finalizeTranscriptConnectAttempt = FunctionSpec.internalMutation({
  name: "finalizeTranscriptConnectAttempt",
  args: () =>
    Schema.Struct({
      provider: TranscriptProvider,
      connectSessionId: Schema.String,
      connectionId: Schema.String,
      expectedConnectionGeneration: Schema.Number,
      providerOrganizationKey: Schema.String,
      providerEndUserId: Schema.String,
      providerConfigKey: Schema.String,
      correlationTag: Schema.String,
      now: Schema.Number,
    }),
  returns: () => connectResult(),
  error: () => connectionError(),
});

export const markTranscriptConnectAttemptFailed = FunctionSpec.internalMutation(
  {
    name: "markTranscriptConnectAttemptFailed",
    args: () =>
      Schema.Struct({
        connectSessionId: Schema.String,
        expectedConnectionGeneration: Schema.Number,
        now: Schema.Number,
      }),
    returns: () => connectResult(),
    error: () => connectionError(),
  },
);

export default GroupSpec.make()
  .addFunction(beginTranscriptConnect)
  .addFunction(completeTranscriptConnect)
  .addFunction(disconnectTranscriptConnection)
  .addFunction(revokeTranscriptConnection)
  .addFunction(finalizeTranscriptDisconnect)
  .addFunction(requestTranscriptPurge)
  .addFunction(prepareTranscriptConnectAttempt)
  .addFunction(authorizeTranscriptConnectCompletion)
  .addFunction(finalizeTranscriptConnectAttempt)
  .addFunction(markTranscriptConnectAttemptFailed);
