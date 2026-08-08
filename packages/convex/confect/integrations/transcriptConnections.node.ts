"use node";

import {
  createFakeNangoClient,
  createLiveNangoClient,
} from "@maestro-template/integrations/nango/client";
import { transcriptProviders } from "@maestro-template/integrations/transcripts/providers";
import { Ref } from "@confect/core";
import { FunctionImpl } from "@confect/server";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";

import databaseSchema from "../_generated/schema";
import { MutationRunner, Scheduler } from "../_generated/services";
import { readProcessEnv } from "../shared/env";
import {
  runTranscriptMutation,
  transcriptConnectionRefs,
} from "./transcriptConnections.impl";
import transcriptConnections, {
  ConnectSessionInvalid,
  ProviderUnavailable,
} from "./transcriptConnections.spec";
import { syncTranscriptPage as syncTranscriptPageSpec } from "./transcriptSync.spec";

const nangoClient = (now: number, providerConfigKey: string) => {
  const env = readProcessEnv();
  if ((env.APP_PROVIDER_MODE ?? "fake").trim().toLowerCase() !== "live")
    return createFakeNangoClient({ now, providerConfigKey });
  const secretKey = env.NANGO_SECRET_KEY?.trim();
  if (!secretKey) throw new ProviderUnavailable();
  return createLiveNangoClient({ secretKey, providerConfigKey });
};
const syncTranscriptPageRef = Ref.make(
  "integrations/transcriptSyncWorker",
  syncTranscriptPageSpec,
);

export const scheduleTranscriptConnectExpiry = (
  runAfter: Scheduler["runAfter"],
  input: {
    readonly connectSessionId: string;
    readonly expectedConnectionGeneration: number;
    readonly attemptExpiresAt: number;
    readonly now: number;
  },
) =>
  runAfter(
    Duration.millis(Math.max(0, input.attemptExpiresAt - input.now)),
    transcriptConnectionRefs.markFailed,
    {
      connectSessionId: input.connectSessionId,
      expectedConnectionGeneration: input.expectedConnectionGeneration,
      now: input.attemptExpiresAt,
    },
  );

export const scheduleTranscriptConnectExpirySafely = <R>(
  runAfter: Scheduler["runAfter"],
  input: Parameters<typeof scheduleTranscriptConnectExpiry>[1],
  markFailed: () => Effect.Effect<unknown, never, R>,
) =>
  scheduleTranscriptConnectExpiry(runAfter, input).pipe(
    Effect.tapErrorCause(() => markFailed()),
    Effect.catchAllCause(() => Effect.fail(new ProviderUnavailable())),
  );

export const beginTranscriptConnect = FunctionImpl.make(
  databaseSchema,
  transcriptConnections,
  "beginTranscriptConnect",
  (input) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const runMutation = yield* MutationRunner;
      const attempt = yield* runTranscriptMutation(
        runMutation,
        transcriptConnectionRefs.prepare,
        {
          provider: input.provider,
          nonce: crypto.randomUUID().replaceAll("-", ""),
          attemptExpiresAt: now + 300_000,
          now,
        },
      );
      yield* scheduleTranscriptConnectExpirySafely(
        (yield* Scheduler).runAfter,
        {
          connectSessionId: attempt.connectSessionId,
          expectedConnectionGeneration: attempt.connectionGeneration,
          attemptExpiresAt: now + 300_000,
          now,
        },
        () =>
          runTranscriptMutation(
            runMutation,
            transcriptConnectionRefs.markFailed,
            {
              connectSessionId: attempt.connectSessionId,
              expectedConnectionGeneration: attempt.connectionGeneration,
              now,
            },
          ).pipe(Effect.ignore),
      );
      const session = yield* Effect.tryPromise({
        try: () =>
          nangoClient(now, attempt.providerConfigKey).createConnectSession({
            organizationKey: attempt.nangoOrganizationId,
            endUserId: attempt.nangoEndUserId,
            providerConfigKey: attempt.providerConfigKey,
            correlationTag: attempt.correlationTag,
            connectSessionId: attempt.connectSessionId,
          }),
        catch: () => new ProviderUnavailable(),
      }).pipe(
        Effect.tapError(() =>
          runTranscriptMutation(
            runMutation,
            transcriptConnectionRefs.markFailed,
            {
              connectSessionId: attempt.connectSessionId,
              expectedConnectionGeneration: attempt.connectionGeneration,
              now,
            },
          ).pipe(Effect.ignore),
        ),
      );
      return session;
    }),
);

export const completeTranscriptConnect = FunctionImpl.make(
  databaseSchema,
  transcriptConnections,
  "completeTranscriptConnect",
  (input) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const runMutation = yield* MutationRunner;
      const authorization = yield* runTranscriptMutation(
        runMutation,
        transcriptConnectionRefs.authorize,
        { ...input, now },
      );
      if (authorization.alreadyCompleted)
        return {
          connectionKey: authorization.connectionKey,
          status: "verifying" as const,
          connectionGeneration: authorization.connectionGeneration,
        };
      const expectedProviderConfigKey =
        transcriptProviders[input.provider].providerConfigKey;
      if (authorization.providerConfigKey !== expectedProviderConfigKey)
        return yield* Effect.fail(new ConnectSessionInvalid());
      const metadata = yield* Effect.tryPromise({
        try: () =>
          nangoClient(now, expectedProviderConfigKey).verifyConnectSession({
            connectSessionId: input.connectSessionId,
            connectionId: input.connectionId,
          }),
        catch: () => new ProviderUnavailable(),
      });
      const result = yield* runTranscriptMutation(
        runMutation,
        transcriptConnectionRefs.finalize,
        {
          ...input,
          expectedConnectionGeneration: authorization.connectionGeneration,
          providerOrganizationKey: metadata.organizationKey,
          providerEndUserId: metadata.endUserId,
          providerConfigKey: metadata.providerConfigKey,
          correlationTag: metadata.correlationTag,
          now: yield* Clock.currentTimeMillis,
        },
      );
      yield* (yield* Scheduler).runAfter(Duration.zero, syncTranscriptPageRef, {
        connectionKey: result.connectionKey,
        expectedGeneration: result.connectionGeneration,
      });
      return result;
    }),
);
