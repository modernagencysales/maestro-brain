import { transcriptProviders } from "@maestro-template/integrations/transcripts/providers";
import { Ref } from "@confect/core";
import { FunctionImpl, GroupImpl } from "@confect/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import {
  Auth,
  DatabaseReader,
  DatabaseWriter,
  MutationRunner,
} from "../_generated/services";
import { asGenericId } from "../access/handlerContext";
import { Forbidden, Unauthorized } from "../errors";
import transcriptConnections, {
  authorizeTranscriptConnectCompletion as authorizeSpec,
  ConnectSessionInvalid,
  ConnectionAlreadyExists,
  finalizeTranscriptConnectAttempt as finalizeSpec,
  markTranscriptConnectAttemptFailed as markFailedSpec,
  prepareTranscriptConnectAttempt as prepareSpec,
  ProviderUnavailable,
  TenantMismatch,
} from "./transcriptConnections.spec";
import {
  beginTranscriptConnect,
  completeTranscriptConnect,
} from "./transcriptConnections.node";
import {
  extractSlackIdentityProfile,
  isSecretShaped,
  selectCurrentSlackOrganization,
  type SlackOrganizationRecord,
} from "./slackConnections.impl";

type TranscriptProvider = keyof typeof transcriptProviders;

const currentAdminOrganizationKey = Effect.gen(function* () {
  const identity = yield* (yield* Auth).getUserIdentity.pipe(
    Effect.mapError(() => new Unauthorized()),
    Effect.flatMap(extractSlackIdentityProfile),
  );
  const user = yield* (yield* DatabaseReader)
    .table("users")
    .index("by_subject", (q) => q.eq("subject", identity.subject.trim()))
    .first()
    .pipe(Effect.map(Option.getOrNull), Effect.orDie);
  if (user === null)
    return yield* Effect.fail(
      new Forbidden({ reason: "Provisioned user required." }),
    );
  const memberships = yield* (yield* DatabaseReader)
    .table("organizationMembers")
    .index("by_user", (q) => q.eq("userId", user._id))
    .take(10)
    .pipe(Effect.orDie);
  const organizations = new Map<string, SlackOrganizationRecord>();
  for (const membership of memberships) {
    const organization = yield* (yield* DatabaseReader)
      .table("organizations")
      .get(asGenericId<"organizations">(membership.organizationId))
      .pipe(Effect.orDie);
    if (organization !== null)
      organizations.set(membership.organizationId, organization);
  }
  const organization = yield* selectCurrentSlackOrganization({
    memberships,
    organizationsById: organizations,
    ...(typeof identity.workosOrganizationId === "string"
      ? { currentWorkosOrganizationId: identity.workosOrganizationId }
      : {}),
  });
  if (organization.agencyKey === undefined)
    return yield* Effect.fail(
      new Forbidden({ reason: "Active organization required." }),
    );
  return organization.agencyKey;
});

const connectionKeyFor = (
  organizationKey: string,
  provider: TranscriptProvider,
) => `${provider}_${organizationKey}`;

const rowByConnectionKey = (connectionKey: string) =>
  DatabaseReader.pipe(
    Effect.flatMap((reader) =>
      reader
        .table("providerConnections")
        .index("by_connection_key", (q) => q.eq("connectionKey", connectionKey))
        .first(),
    ),
    Effect.map(Option.getOrNull),
    Effect.orDie,
  );

const rowBySession = (connectSessionId: string) =>
  DatabaseReader.pipe(
    Effect.flatMap((reader) =>
      reader
        .table("providerConnections")
        .index("by_connect_session", (q) =>
          q.eq("connectSessionId", connectSessionId),
        )
        .first(),
    ),
    Effect.map(Option.getOrNull),
    Effect.orDie,
  );

const prepareTranscriptConnectAttempt = FunctionImpl.make(
  databaseSchema,
  transcriptConnections,
  "prepareTranscriptConnectAttempt",
  (input) =>
    Effect.gen(function* () {
      const organizationKey = yield* currentAdminOrganizationKey;
      const providerConfigKey =
        transcriptProviders[input.provider].providerConfigKey;
      const connectionKey = connectionKeyFor(organizationKey, input.provider);
      const current = yield* rowByConnectionKey(connectionKey);
      const connectSessionId = `maestro-session-${input.nonce}`;
      if (
        current !== null &&
        current.connectSessionId !== connectSessionId &&
        (current.status === "authorizing" ||
          current.status === "reauthorizing") &&
        current.attemptExpiresAt > input.now
      )
        return yield* Effect.fail(
          new ConnectionAlreadyExists({ organizationKey }),
        );
      const connectionGeneration = current?.connectionGeneration ?? 0;
      const nangoEndUserId = `nango-user-${providerConfigKey}-${input.nonce}`;
      const nangoOrganizationId = `nango-org-${providerConfigKey}-${input.nonce}`;
      const correlationTag = `${providerConfigKey}-connect:${connectSessionId}`;
      const row = {
        provider: "nango" as const,
        providerConfigKey,
        organizationKey,
        connectionKey,
        connectionGeneration,
        status:
          current !== null &&
          (current.connectionGeneration > 0 || current.nangoConnectionId)
            ? ("reauthorizing" as const)
            : ("authorizing" as const),
        connectSessionId,
        nangoConnectionId: null,
        nangoEndUserId,
        nangoOrganizationId,
        correlationTag,
        attemptId: `attempt_${input.nonce}`,
        attemptExpiresAt: input.attemptExpiresAt,
        completedAt: null,
        updatedAt: input.now,
      };
      const writer = (yield* DatabaseWriter).table("providerConnections");
      if (current === null)
        yield* writer
          .insert({ ...row, createdAt: input.now })
          .pipe(Effect.orDie);
      else yield* writer.patch(current._id, row).pipe(Effect.orDie);
      return {
        organizationKey,
        connectionKey,
        connectionGeneration,
        providerConfigKey,
        connectSessionId,
        nangoEndUserId,
        nangoOrganizationId,
        correlationTag,
      };
    }),
);

const authorizeTranscriptConnectCompletion = FunctionImpl.make(
  databaseSchema,
  transcriptConnections,
  "authorizeTranscriptConnectCompletion",
  (input) =>
    Effect.gen(function* () {
      if (isSecretShaped(input.connectionId))
        return yield* Effect.fail(new ConnectSessionInvalid());
      const organizationKey = yield* currentAdminOrganizationKey;
      const row = yield* rowBySession(input.connectSessionId);
      const providerConfigKey =
        transcriptProviders[input.provider].providerConfigKey;
      if (
        row === null ||
        row.organizationKey !== organizationKey ||
        row.providerConfigKey !== providerConfigKey
      )
        return yield* Effect.fail(new TenantMismatch());
      if (row.status === "verifying") {
        if (row.nangoConnectionId !== input.connectionId)
          return yield* Effect.fail(new ConnectSessionInvalid());
        return {
          connectionKey: row.connectionKey,
          connectionGeneration: row.connectionGeneration,
          providerConfigKey: row.providerConfigKey,
          nangoEndUserId: row.nangoEndUserId,
          nangoOrganizationId: row.nangoOrganizationId,
          correlationTag: row.correlationTag,
          alreadyCompleted: true,
        };
      }
      if (
        (row.status !== "authorizing" && row.status !== "reauthorizing") ||
        row.attemptExpiresAt <= input.now
      )
        return yield* Effect.fail(new ConnectSessionInvalid());
      return {
        connectionKey: row.connectionKey,
        connectionGeneration: row.connectionGeneration,
        providerConfigKey: row.providerConfigKey,
        nangoEndUserId: row.nangoEndUserId,
        nangoOrganizationId: row.nangoOrganizationId,
        correlationTag: row.correlationTag,
        alreadyCompleted: false,
      };
    }),
);

const finalizeTranscriptConnectAttempt = FunctionImpl.make(
  databaseSchema,
  transcriptConnections,
  "finalizeTranscriptConnectAttempt",
  (input) =>
    Effect.gen(function* () {
      const organizationKey = yield* currentAdminOrganizationKey;
      const row = yield* rowBySession(input.connectSessionId);
      const expectedProviderConfigKey =
        transcriptProviders[input.provider].providerConfigKey;
      if (
        row === null ||
        row.organizationKey !== organizationKey ||
        row.providerConfigKey !== expectedProviderConfigKey ||
        row.nangoOrganizationId !== input.providerOrganizationKey ||
        row.nangoEndUserId !== input.providerEndUserId ||
        row.providerConfigKey !== input.providerConfigKey ||
        row.correlationTag !== input.correlationTag
      )
        return yield* Effect.fail(new TenantMismatch());
      if (
        row.connectionGeneration !== input.expectedConnectionGeneration ||
        (row.status !== "authorizing" && row.status !== "reauthorizing") ||
        row.attemptExpiresAt <= input.now ||
        isSecretShaped(input.connectionId)
      )
        return yield* Effect.fail(new ConnectSessionInvalid());
      yield* (yield* DatabaseWriter)
        .table("providerConnections")
        .patch(row._id, {
          status: "verifying",
          nangoConnectionId: input.connectionId,
          completedAt: input.now,
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);
      return {
        connectionKey: row.connectionKey,
        status: "verifying" as const,
        connectionGeneration: row.connectionGeneration,
      };
    }),
);

const markTranscriptConnectAttemptFailed = FunctionImpl.make(
  databaseSchema,
  transcriptConnections,
  "markTranscriptConnectAttemptFailed",
  (input) =>
    Effect.gen(function* () {
      const row = yield* rowBySession(input.connectSessionId);
      if (
        row === null ||
        row.connectionGeneration !== input.expectedConnectionGeneration
      )
        return yield* Effect.fail(new ConnectSessionInvalid());
      yield* (yield* DatabaseWriter)
        .table("providerConnections")
        .patch(row._id, {
          status: "error",
          completedAt: null,
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);
      return {
        connectionKey: row.connectionKey,
        status: "error" as const,
        connectionGeneration: row.connectionGeneration,
      };
    }),
);

type TranscriptConnectionError =
  | Unauthorized
  | Forbidden
  | ConnectionAlreadyExists
  | ConnectSessionInvalid
  | ProviderUnavailable
  | TenantMismatch;

export const runTranscriptMutation = <Mutation extends Ref.AnyMutation>(
  runMutation: MutationRunner,
  mutation: Mutation,
  ...args: Ref.OptionalArgs<Mutation>
) =>
  runMutation(mutation, ...args).pipe(
    Effect.mapError((error): TranscriptConnectionError =>
      error instanceof Unauthorized ||
      error instanceof Forbidden ||
      error instanceof ConnectionAlreadyExists ||
      error instanceof ConnectSessionInvalid ||
      error instanceof ProviderUnavailable ||
      error instanceof TenantMismatch
        ? error
        : new ProviderUnavailable(),
    ),
  );

export const transcriptConnectionRefs = {
  prepare: Ref.make("integrations/transcriptConnections", prepareSpec),
  authorize: Ref.make("integrations/transcriptConnections", authorizeSpec),
  finalize: Ref.make("integrations/transcriptConnections", finalizeSpec),
  markFailed: Ref.make("integrations/transcriptConnections", markFailedSpec),
};

export default GroupImpl.make(databaseSchema, transcriptConnections).pipe(
  Layer.provide(beginTranscriptConnect),
  Layer.provide(completeTranscriptConnect),
  Layer.provide(prepareTranscriptConnectAttempt),
  Layer.provide(authorizeTranscriptConnectCompletion),
  Layer.provide(finalizeTranscriptConnectAttempt),
  Layer.provide(markTranscriptConnectAttemptFailed),
  GroupImpl.finalize,
);
