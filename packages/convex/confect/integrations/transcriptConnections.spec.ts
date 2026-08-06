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
  error: connectionError,
});

export const completeTranscriptConnect = FunctionSpec.publicAction({
  name: "completeTranscriptConnect",
  args: () =>
    Schema.Struct({
      provider: TranscriptProvider,
      connectSessionId: Schema.String,
      connectionId: Schema.String,
    }),
  returns: connectResult,
  error: connectionError,
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
  error: connectionError,
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
    error: connectionError,
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
  returns: connectResult,
  error: connectionError,
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
    returns: connectResult,
    error: connectionError,
  },
);

export default GroupSpec.make()
  .addFunction(beginTranscriptConnect)
  .addFunction(completeTranscriptConnect)
  .addFunction(prepareTranscriptConnectAttempt)
  .addFunction(authorizeTranscriptConnectCompletion)
  .addFunction(finalizeTranscriptConnectAttempt)
  .addFunction(markTranscriptConnectAttemptFailed);
