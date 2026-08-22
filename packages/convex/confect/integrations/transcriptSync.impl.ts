import { transcriptProviders } from "@maestro-template/integrations/transcripts/providers";
import type { CanonicalCallTranscript } from "@maestro-template/integrations/transcripts/canonical";
import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import {
  connectionFenceIdentity,
  transitionEligibilityFenceEffect,
} from "../brain/retrievalEligibility";
import { enqueueOrganizationCorpusRebuildsEffect } from "../brain/retrievalPublication.impl";
import {
  providerTargetResolutionAuthorityDigest,
  providerTargetResolutionIntentKey,
  type LiveCaptureTargetResolutionAuthority,
} from "../brain/providerTargetResolution";
import { ingestSourceUnitEffect } from "../capabilities/ingestSourceUnit.impl";
import { ValidationFailed } from "../errors";
import { sha256Hex } from "../shared/sha256";
import { currentAdminOrganizationKey } from "./transcriptConnections.impl";
import transcriptSync, {
  TranscriptSyncConnectionNotFound,
  TranscriptSyncFenceError,
} from "./transcriptSync.spec";

export { TranscriptSyncFenceError } from "./transcriptSync.spec";

export type TranscriptSyncStatus =
  "queued" | "syncing" | "ready" | "retry_wait" | "error" | "revoked";

export type TranscriptSyncErrorTag =
  | "ProviderRateLimited"
  | "ProviderUnavailable"
  | "PermanentDecodeFailure"
  | "RevisionOrderConflict";

export type TranscriptSyncState = {
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly provider: "fireflies" | "gong" | "fathom" | "granola";
  readonly status: TranscriptSyncStatus;
  readonly cursor: string | null;
  readonly leaseId: string | null;
  readonly leaseExpiresAt: number | null;
  readonly nextAttemptAt: number;
  readonly lastSuccessAt: number | null;
  readonly callsDiscovered: number;
  readonly callsIngested: number;
  readonly duplicateCount: number;
  readonly failureCount: number;
  readonly lastErrorTag: TranscriptSyncErrorTag | null;
  readonly backfillComplete: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
};

const assertGeneration = (
  state: TranscriptSyncState,
  connectionGeneration: number,
) =>
  state.connectionGeneration === connectionGeneration
    ? Effect.void
    : Effect.fail(new TranscriptSyncFenceError());

export const selectNextTranscriptSyncState = (
  states: readonly TranscriptSyncState[],
  now: number,
): TranscriptSyncState | undefined =>
  states
    .filter(
      (state) =>
        (state.status === "queued" ||
          state.status === "ready" ||
          state.status === "retry_wait") &&
        state.nextAttemptAt <= now,
    )
    .sort(
      (left, right) =>
        left.updatedAt - right.updatedAt ||
        left.connectionKey.localeCompare(right.connectionKey),
    )[0];

export const claimTranscriptSyncState = (input: {
  readonly state: TranscriptSyncState;
  readonly connectionGeneration: number;
  readonly leaseId: string;
  readonly now: number;
}) =>
  Effect.gen(function* () {
    yield* assertGeneration(input.state, input.connectionGeneration);
    if (
      input.state.status === "revoked" ||
      input.state.status === "error" ||
      (input.state.status === "syncing" &&
        (input.state.leaseExpiresAt ?? Number.MAX_SAFE_INTEGER) > input.now)
    )
      return yield* Effect.fail(new TranscriptSyncFenceError());
    return {
      ...input.state,
      status: "syncing",
      leaseId: input.leaseId,
      leaseExpiresAt: input.now + 60_000,
      updatedAt: input.now,
    } satisfies TranscriptSyncState;
  });

const assertClaim = (input: {
  readonly state: TranscriptSyncState;
  readonly connectionGeneration: number;
  readonly expectedCursor: string | null;
  readonly leaseId: string;
}) =>
  Effect.gen(function* () {
    yield* assertGeneration(input.state, input.connectionGeneration);
    if (
      input.state.status !== "syncing" ||
      input.state.leaseId !== input.leaseId ||
      input.state.cursor !== input.expectedCursor
    )
      return yield* Effect.fail(new TranscriptSyncFenceError());
  });

export const commitTranscriptSyncState = (input: {
  readonly state: TranscriptSyncState;
  readonly connectionGeneration: number;
  readonly expectedCursor: string | null;
  readonly leaseId: string;
  readonly nextCursor: string | null;
  readonly discovered: number;
  readonly ingested: number;
  readonly duplicates: number;
  readonly now: number;
}) =>
  Effect.gen(function* () {
    yield* assertClaim(input);
    return {
      ...input.state,
      status: input.nextCursor === null ? "ready" : "queued",
      cursor: input.nextCursor,
      leaseId: null,
      leaseExpiresAt: null,
      nextAttemptAt:
        input.nextCursor === null ? input.now + 300_000 : input.now,
      lastSuccessAt: input.now,
      callsDiscovered: input.state.callsDiscovered + input.discovered,
      callsIngested: input.state.callsIngested + input.ingested,
      duplicateCount: input.state.duplicateCount + input.duplicates,
      lastErrorTag: null,
      backfillComplete: input.nextCursor === null,
      updatedAt: input.now,
    } satisfies TranscriptSyncState;
  });

export const failTranscriptSyncState = (input: {
  readonly state: TranscriptSyncState;
  readonly connectionGeneration: number;
  readonly expectedCursor: string | null;
  readonly leaseId: string;
  readonly errorTag: TranscriptSyncErrorTag;
  readonly retryAfterMs: number | null;
  readonly now: number;
}) =>
  Effect.gen(function* () {
    yield* assertClaim(input);
    const permanent =
      input.errorTag === "PermanentDecodeFailure" ||
      input.errorTag === "RevisionOrderConflict";
    return {
      ...input.state,
      status: permanent ? "error" : "retry_wait",
      leaseId: null,
      leaseExpiresAt: null,
      nextAttemptAt: input.now + (input.retryAfterMs ?? 0),
      failureCount: input.state.failureCount + 1,
      lastErrorTag: input.errorTag,
      updatedAt: input.now,
    } satisfies TranscriptSyncState;
  });

type RawIndexBuilder = {
  readonly eq: (field: string, value: unknown) => RawIndexBuilder;
};
type RawQuery = {
  readonly index: (
    name: string,
    range: (builder: RawIndexBuilder) => RawIndexBuilder,
  ) => RawQuery;
  readonly first: () => Effect.Effect<Option.Option<unknown>, unknown>;
  readonly collect: () => Effect.Effect<readonly unknown[], unknown>;
  readonly take: (count: number) => Effect.Effect<readonly unknown[], unknown>;
};
type RawReader = { readonly table: (name: string) => RawQuery };
type RawWriterTable = {
  readonly insert: (
    row: Record<string, unknown>,
  ) => Effect.Effect<unknown, unknown>;
  readonly patch: (
    id: GenericId<string>,
    patch: Record<string, unknown>,
  ) => Effect.Effect<unknown, unknown>;
};
type RawWriter = { readonly table: (name: string) => RawWriterTable };
type StoredSyncState = TranscriptSyncState & {
  readonly _id: GenericId<"connectorSyncStates">;
};
type StoredConnection = {
  readonly _id: GenericId<"providerConnections">;
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly providerConfigKey: string;
  readonly nangoConnectionId?: string | null;
  readonly status: string;
  readonly attemptExpiresAt: number;
};
type StoredLiveParentObligation = {
  readonly authorityKind?: string;
  readonly parentIngestionObligationKey?: string;
  readonly workspaceId?: GenericId<"workspaces">;
  readonly brainKey?: string;
  readonly allowlistGeneration?: number;
  readonly requiredScopeIntentKey?: string;
  readonly organizationKey: string;
  readonly providerKind: string;
  readonly connectorScopeKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly originRevisionKey: string;
  readonly targetResolutionIntentId?: GenericId<"providerTargetResolutionIntents">;
  readonly targetResolutionIntentKey: string | null;
};
type HealthConnection = Pick<
  StoredConnection,
  | "providerConfigKey"
  | "organizationKey"
  | "connectionKey"
  | "connectionGeneration"
  | "status"
  | "attemptExpiresAt"
  | "nangoConnectionId"
> & {
  readonly errorReason?: string | null;
  readonly purgeRequestedAt?: number | null;
};
type HealthSourceUnit = {
  readonly connectionKey: string;
  readonly unitKey: string;
  readonly lifecycle: { readonly state: string };
};
type HealthRoute = {
  readonly unitKey: string;
  readonly outcome: string;
  readonly status: string;
};

const rawReader = (reader: unknown) => reader as RawReader;
const rawWriter = (writer: unknown) => writer as RawWriter;
const syncStateByConnection = (connectionKey: string) =>
  Effect.gen(function* () {
    const reader = rawReader(yield* DatabaseReader);
    return (yield* reader
      .table("connectorSyncStates")
      .index("by_connection", (q) => q.eq("connectionKey", connectionKey))
      .first()
      .pipe(
        Effect.map(Option.getOrNull),
        Effect.orDie,
      )) as StoredSyncState | null;
  });
const connectionByKey = (connectionKey: string) =>
  Effect.gen(function* () {
    const reader = rawReader(yield* DatabaseReader);
    return (yield* reader
      .table("providerConnections")
      .index("by_connection_key", (q) => q.eq("connectionKey", connectionKey))
      .first()
      .pipe(
        Effect.map(Option.getOrNull),
        Effect.orDie,
      )) as StoredConnection | null;
  });
const providerForConfig = (providerConfigKey: string) =>
  Object.entries(transcriptProviders).find(
    ([, provider]) => provider.providerConfigKey === providerConfigKey,
  )?.[0] as TranscriptSyncState["provider"] | undefined;

export const buildTranscriptConnectionHealth = (input: {
  readonly now: number;
  readonly connections: readonly HealthConnection[];
  readonly syncStates: readonly TranscriptSyncState[];
  readonly sourceUnits: readonly HealthSourceUnit[];
  readonly routes: readonly HealthRoute[];
}) =>
  input.connections.flatMap((connection) => {
    const provider = providerForConfig(connection.providerConfigKey);
    if (!provider) return [];
    const sync = input.syncStates.find(
      (candidate) =>
        candidate.connectionKey === connection.connectionKey &&
        candidate.connectionGeneration === connection.connectionGeneration,
    );
    const units = input.sourceUnits.filter(
      (unit) =>
        unit.connectionKey === connection.connectionKey &&
        unit.lifecycle.state === "active",
    );
    const unitKeys = new Set(units.map((unit) => unit.unitKey));
    const callsRouted = new Set(
      input.routes
        .filter(
          (route) =>
            unitKeys.has(route.unitKey) &&
            route.outcome === "routed" &&
            (route.status === "current" || route.status === "accepted"),
        )
        .map((route) => route.unitKey),
    ).size;
    const authorizationExpired =
      (connection.status === "authorizing" ||
        connection.status === "reauthorizing") &&
      connection.attemptExpiresAt <= input.now;
    const state = authorizationExpired
      ? ("error" as const)
      : connection.status === "authorizing"
        ? ("authorizing" as const)
        : connection.status === "reauthorizing"
          ? ("reauthorizing" as const)
          : connection.status === "revoked"
            ? ("revoked" as const)
            : connection.status === "error" || sync?.status === "error"
              ? ("error" as const)
              : sync?.status === "ready"
                ? ("ready" as const)
                : ("syncing" as const);
    return [
      {
        provider,
        connectionKey: connection.connectionKey,
        state,
        lastSuccessAt: sync?.lastSuccessAt ?? null,
        cursorPresent: sync?.cursor !== null && sync?.cursor !== undefined,
        callsDiscovered: sync?.callsDiscovered ?? 0,
        callsIngested: sync?.callsIngested ?? 0,
        callsRouted,
        callsAwaitingRouting: Math.max(0, units.length - callsRouted),
        backfillComplete: sync?.backfillComplete ?? false,
        cleanupPending: connection.errorReason === "NangoCleanupPending",
        disconnectAvailable: connection.nangoConnectionId != null,
        purgeRequested: connection.purgeRequestedAt != null,
        lastErrorTag: sync?.lastErrorTag ?? null,
      },
    ];
  });

const initialState = (input: {
  readonly connection: StoredConnection;
  readonly provider: TranscriptSyncState["provider"];
  readonly connectionGeneration: number;
  readonly now: number;
}): TranscriptSyncState => ({
  organizationKey: input.connection.organizationKey,
  connectionKey: input.connection.connectionKey,
  connectionGeneration: input.connectionGeneration,
  provider: input.provider,
  status: "queued",
  cursor: null,
  leaseId: null,
  leaseExpiresAt: null,
  nextAttemptAt: input.now,
  lastSuccessAt: null,
  callsDiscovered: 0,
  callsIngested: 0,
  duplicateCount: 0,
  failureCount: 0,
  lastErrorTag: null,
  backfillComplete: false,
  createdAt: input.now,
  updatedAt: input.now,
});

const claimTranscriptSyncPageImpl = FunctionImpl.make(
  databaseSchema,
  transcriptSync,
  "claimTranscriptSyncPage",
  (input) =>
    Effect.gen(function* () {
      const connection = yield* connectionByKey(input.connectionKey);
      const provider = connection
        ? providerForConfig(connection.providerConfigKey)
        : undefined;
      if (
        !connection ||
        !provider ||
        !connection.nangoConnectionId ||
        (connection.status !== "verifying" && connection.status !== "active")
      )
        return yield* Effect.fail(new TranscriptSyncConnectionNotFound());
      if (connection.connectionGeneration !== input.expectedGeneration)
        return yield* Effect.fail(new TranscriptSyncFenceError());

      const generation =
        connection.status === "verifying"
          ? connection.connectionGeneration + 1
          : connection.connectionGeneration;
      const existing = yield* syncStateByConnection(input.connectionKey);
      const current =
        existing === null || existing.connectionGeneration !== generation
          ? initialState({
              connection,
              provider,
              connectionGeneration: generation,
              now: input.now,
            })
          : existing;
      const claimed = yield* claimTranscriptSyncState({
        state: current,
        connectionGeneration: generation,
        leaseId: input.leaseId,
        now: input.now,
      });
      const writer = rawWriter(yield* DatabaseWriter);
      if (connection.status === "verifying")
        yield* writer
          .table("providerConnections")
          .patch(connection._id, {
            status: "active",
            connectionGeneration: generation,
            updatedAt: input.now,
          })
          .pipe(Effect.orDie);
      if (connection.status === "verifying")
        yield* transitionEligibilityFenceEffect({
          identity: connectionFenceIdentity({
            organizationKey: connection.organizationKey,
            connectionKey: connection.connectionKey,
          }),
          eligible: true,
          now: input.now,
        });
      if (existing === null)
        yield* writer
          .table("connectorSyncStates")
          .insert(claimed)
          .pipe(Effect.orDie);
      else
        yield* writer
          .table("connectorSyncStates")
          .patch(existing._id, claimed)
          .pipe(Effect.orDie);
      if (connection.status === "verifying")
        yield* enqueueOrganizationCorpusRebuildsEffect({
          organizationKey: connection.organizationKey,
          originKind: "transcript_rebuild",
          sourceKey: connection.connectionKey,
          sourceRevisionKey: `connection:${connection.connectionKey}:active:${generation}`,
          requestGeneration: generation,
          now: input.now,
        });
      return {
        organizationKey: connection.organizationKey,
        connectionKey: connection.connectionKey,
        connectionGeneration: generation,
        provider,
        providerConfigKey: connection.providerConfigKey,
        nangoConnectionId: connection.nangoConnectionId,
        cursor: claimed.cursor,
        leaseId: input.leaseId,
      };
    }),
);

const updateSyncState = (input: {
  readonly connectionKey: string;
  readonly update: (
    state: StoredSyncState,
  ) => Effect.Effect<TranscriptSyncState, TranscriptSyncFenceError>;
}) =>
  Effect.gen(function* () {
    const current = yield* syncStateByConnection(input.connectionKey);
    if (current === null)
      return yield* Effect.fail(new TranscriptSyncConnectionNotFound());
    const updated = yield* input.update(current);
    yield* rawWriter(yield* DatabaseWriter)
      .table("connectorSyncStates")
      .patch(current._id, updated)
      .pipe(Effect.orDie);
    return updated;
  });

const MAX_ATOMIC_TRANSCRIPT_CALLS = 100;
const MAX_ATOMIC_TRANSCRIPT_WRITES = 7_000;
const MAX_ATOMIC_TRANSCRIPT_BYTES = 5_000_000;

export const transcriptSyncPageCapacity = (
  calls: readonly Pick<CanonicalCallTranscript, "segments">[],
) => {
  const segmentCount = calls.reduce(
    (count, call) => count + call.segments.length,
    0,
  );
  const estimatedWrites = segmentCount + calls.length * 7 + 1;
  const encodedBytes = new TextEncoder().encode(JSON.stringify(calls)).length;
  return {
    callCount: calls.length,
    segmentCount,
    estimatedWrites,
    encodedBytes,
    accepted:
      calls.length <= MAX_ATOMIC_TRANSCRIPT_CALLS &&
      estimatedWrites <= MAX_ATOMIC_TRANSCRIPT_WRITES &&
      encodedBytes <= MAX_ATOMIC_TRANSCRIPT_BYTES,
  };
};

const liveTranscriptParentAuthority = (input: {
  readonly organizationKey: string;
  readonly connectionKey: string;
  readonly connectionGeneration: number;
  readonly expectedCursor: string | null;
  readonly unitKey: string;
  readonly unitRevisionKey: string;
  readonly membershipKey: string;
  readonly observationDigest: string;
  readonly capturedAt: number;
}): LiveCaptureTargetResolutionAuthority => {
  const ingestionObligationKey = `iobl_${sha256Hex(
    JSON.stringify({
      authorityKind: "live_capture",
      providerKind: "transcript",
      connectionKey: input.connectionKey,
      connectionGeneration: input.connectionGeneration,
      unitRevisionKey: input.unitRevisionKey,
    }),
  )}`;
  return {
    authorityKind: "live_capture",
    targetResolutionIntentKey: providerTargetResolutionIntentKey({
      ingestionObligationKey,
    }),
    ingestionObligationKey,
    organizationKey: input.organizationKey,
    corpusKey: "transcripts",
    providerKind: "transcript",
    connectorScopeKey: input.connectionKey,
    connectionKey: input.connectionKey,
    connectionGeneration: input.connectionGeneration,
    membershipKey: input.membershipKey,
    originKind: "transcript",
    originKey: input.unitKey,
    originRevisionKey: input.unitRevisionKey,
    observationDigest: input.observationDigest,
    resolutionGeneration: 1,
    captureKey: `transcript-sync:${input.connectionKey}:${JSON.stringify(
      input.expectedCursor,
    )}:${input.unitRevisionKey}`,
    capturedAt: input.capturedAt,
  };
};

const liveParentObligationState = (
  status:
    | "pending"
    | "retry_wait"
    | "capacity_blocked"
    | "succeeded"
    | "policy_excluded"
    | "stale"
    | "integrity_failure",
) =>
  status === "pending"
    ? ("target_resolution_pending" as const)
    : status === "succeeded"
      ? ("complete" as const)
      : status === "policy_excluded" || status === "stale"
        ? ("policy_excluded" as const)
        : status === "integrity_failure"
          ? ("failed" as const)
          : status;

const commitTranscriptSyncPageImpl = FunctionImpl.make(
  databaseSchema,
  transcriptSync,
  "commitTranscriptSyncPage",
  (input) =>
    updateSyncState({
      connectionKey: input.connectionKey,
      update: (state) =>
        commitTranscriptSyncState({
          state,
          connectionGeneration: input.expectedGeneration,
          expectedCursor: input.expectedCursor,
          leaseId: input.leaseId,
          nextCursor: input.nextCursor,
          discovered: input.discovered,
          ingested: input.ingested,
          duplicates: input.duplicates,
          now: input.now,
        }),
    }),
);

const ingestTranscriptSyncPageImpl = FunctionImpl.make(
  databaseSchema,
  transcriptSync,
  "ingestTranscriptSyncPage",
  (input) =>
    Effect.gen(function* () {
      const capacity = transcriptSyncPageCapacity(input.calls);
      if (!capacity.accepted)
        return yield* new ValidationFailed({
          field: "calls",
          message:
            "Transcript sync page exceeds the bounded atomic mutation capacity.",
        });
      const current = yield* syncStateByConnection(input.connectionKey);
      if (current === null)
        return yield* Effect.fail(new TranscriptSyncConnectionNotFound());
      yield* commitTranscriptSyncState({
        state: current,
        connectionGeneration: input.expectedGeneration,
        expectedCursor: input.expectedCursor,
        leaseId: input.leaseId,
        nextCursor: input.nextCursor,
        discovered: 0,
        ingested: 0,
        duplicates: 0,
        now: input.now,
      });
      let ingested = 0;
      let duplicates = 0;
      const reader = rawReader(yield* DatabaseReader);
      const writer = rawWriter(yield* DatabaseWriter);
      for (const call of input.calls) {
        const receipt = yield* ingestSourceUnitEffect({
          input: call,
          authority: {
            kind: "provider",
            organizationKey: current.organizationKey,
            connectionKey: current.connectionKey,
            connectionGeneration: current.connectionGeneration,
          },
          caller: {
            kind: "system",
            name: "transcript-sync-atomic-page",
            surface: "internal",
          },
          receivedAt: input.now,
        });
        if (receipt.outcome === "duplicate") {
          duplicates += 1;
          continue;
        }
        ingested += 1;
        const revisions = yield* reader
          .table("sourceUnitRevisions")
          .index("by_unit_revision_key", (query) =>
            query
              .eq("organizationKey", current.organizationKey)
              .eq("unitRevisionKey", receipt.unitRevisionKey),
          )
          .take(2)
          .pipe(Effect.orDie);
        const revision = revisions[0] as
          | {
              readonly unitKey: string;
              readonly unitRevisionKey: string;
              readonly contentHash: string;
            }
          | undefined;
        if (
          revisions.length !== 1 ||
          revision === undefined ||
          revision.unitKey !== receipt.unitKey ||
          revision.unitRevisionKey !== receipt.unitRevisionKey
        )
          return yield* new ValidationFailed({
            field: "calls",
            message: "Atomic transcript ingestion lost revision authority.",
          });
        const authority = liveTranscriptParentAuthority({
          organizationKey: current.organizationKey,
          connectionKey: current.connectionKey,
          connectionGeneration: current.connectionGeneration,
          expectedCursor: input.expectedCursor,
          unitKey: receipt.unitKey,
          unitRevisionKey: receipt.unitRevisionKey,
          membershipKey: call.externalCallId,
          observationDigest: revision.contentHash,
          capturedAt: input.now,
        });
        const parents = yield* reader
          .table("providerTargetResolutionIntents")
          .index("by_target_resolution_intent_key", (query) =>
            query.eq(
              "targetResolutionIntentKey",
              authority.targetResolutionIntentKey,
            ),
          )
          .take(2)
          .pipe(Effect.orDie);
        const existing = parents[0] as
          | {
              readonly _id: GenericId<"providerTargetResolutionIntents">;
              readonly authorityKind?: string;
              readonly authorityDigest: string;
              readonly status:
                | "pending"
                | "retry_wait"
                | "capacity_blocked"
                | "succeeded"
                | "policy_excluded"
                | "stale"
                | "integrity_failure";
            }
          | undefined;
        const authorityDigest =
          providerTargetResolutionAuthorityDigest(authority);
        if (
          parents.length > 1 ||
          (existing !== undefined &&
            (existing.authorityKind !== "live_capture" ||
              existing.authorityDigest !== authorityDigest))
        )
          return yield* new ValidationFailed({
            field: "calls",
            message: "Transcript live-capture parent authority conflicts.",
          });
        const providerTargetResolutionIntentId =
          existing?._id ??
          ((yield* writer
            .table("providerTargetResolutionIntents")
            .insert({
              schemaVersion: 1,
              ...authority,
              authorityDigest,
              status: "pending",
              attemptCount: 0,
              nextAttemptAt: input.now,
              lastErrorTag: null,
              targetCount: 0,
              targetDigest: null,
              targets: [],
              completedAt: null,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .pipe(
              Effect.orDie,
            )) as GenericId<"providerTargetResolutionIntents">);
        const obligations = yield* reader
          .table("ingestionObligations")
          .index("by_ingestion_obligation_key", (query) =>
            query.eq(
              "ingestionObligationKey",
              authority.ingestionObligationKey,
            ),
          )
          .take(2)
          .pipe(Effect.orDie);
        const obligation = obligations[0] as
          StoredLiveParentObligation | undefined;
        if (
          obligations.length > 1 ||
          (obligation !== undefined &&
            (obligation.authorityKind !== "live_capture" ||
              obligation.parentIngestionObligationKey !== undefined ||
              obligation.workspaceId !== undefined ||
              obligation.brainKey !== undefined ||
              obligation.allowlistGeneration !== undefined ||
              obligation.requiredScopeIntentKey !== undefined ||
              obligation.organizationKey !== current.organizationKey ||
              obligation.providerKind !== "transcript" ||
              obligation.connectorScopeKey !== current.connectionKey ||
              obligation.connectionKey !== current.connectionKey ||
              obligation.connectionGeneration !==
                current.connectionGeneration ||
              obligation.originRevisionKey !== receipt.unitRevisionKey ||
              obligation.targetResolutionIntentId !==
                providerTargetResolutionIntentId ||
              obligation.targetResolutionIntentKey !==
                authority.targetResolutionIntentKey))
        )
          return yield* new ValidationFailed({
            field: "calls",
            message: "Transcript live parent obligation authority conflicts.",
          });
        if (obligation === undefined) {
          const providerStatus = existing?.status ?? "pending";
          yield* writer
            .table("ingestionObligations")
            .insert({
              schemaVersion: 1,
              authorityKind: "live_capture",
              organizationKey: current.organizationKey,
              corpusKey: "transcripts",
              providerKind: "transcript",
              connectorScopeKey: current.connectionKey,
              connectionKey: current.connectionKey,
              connectionGeneration: current.connectionGeneration,
              ingestionObligationKey: authority.ingestionObligationKey,
              cause: "observation",
              membershipKey: call.externalCallId,
              originKind: "transcript",
              originKey: receipt.unitKey,
              originRevisionKey: receipt.unitRevisionKey,
              ledgerSequence: input.now,
              state: liveParentObligationState(providerStatus),
              targetResolutionIntentId: providerTargetResolutionIntentId,
              targetResolutionIntentKey: authority.targetResolutionIntentKey,
              publicationJobKeys: [],
              errorTag:
                providerStatus === "integrity_failure"
                  ? "TranscriptTargetResolutionIntegrityFailure"
                  : null,
              terminalAt:
                providerStatus === "succeeded" ||
                providerStatus === "policy_excluded" ||
                providerStatus === "stale" ||
                providerStatus === "integrity_failure"
                  ? input.now
                  : null,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .pipe(Effect.orDie);
        }
      }
      const updated = yield* commitTranscriptSyncState({
        state: current,
        connectionGeneration: input.expectedGeneration,
        expectedCursor: input.expectedCursor,
        leaseId: input.leaseId,
        nextCursor: input.nextCursor,
        discovered: input.calls.length,
        ingested,
        duplicates,
        now: input.now,
      });
      yield* writer
        .table("connectorSyncStates")
        .patch(current._id, updated)
        .pipe(Effect.orDie);
      return updated;
    }),
);

const failTranscriptSyncPageImpl = FunctionImpl.make(
  databaseSchema,
  transcriptSync,
  "failTranscriptSyncPage",
  (input) =>
    updateSyncState({
      connectionKey: input.connectionKey,
      update: (state) =>
        failTranscriptSyncState({
          state,
          connectionGeneration: input.expectedGeneration,
          expectedCursor: input.expectedCursor,
          leaseId: input.leaseId,
          errorTag: input.errorTag,
          retryAfterMs: input.retryAfterMs,
          now: input.now,
        }),
    }),
);

const listTranscriptConnectionHealthImpl = FunctionImpl.make(
  databaseSchema,
  transcriptSync,
  "listTranscriptConnectionHealth",
  () =>
    Effect.gen(function* () {
      const organizationKey = yield* currentAdminOrganizationKey;
      const reader = rawReader(yield* DatabaseReader);
      const connections = (yield* reader
        .table("providerConnections")
        .index("by_organization", (q) =>
          q.eq("organizationKey", organizationKey),
        )
        .collect()
        .pipe(Effect.orDie)) as readonly HealthConnection[];
      const syncStates = (yield* reader
        .table("connectorSyncStates")
        .index("by_organization_provider", (q) =>
          q.eq("organizationKey", organizationKey),
        )
        .collect()
        .pipe(Effect.orDie)) as readonly TranscriptSyncState[];
      const sourceUnits: HealthSourceUnit[] = [];
      for (const connection of connections) {
        const units = (yield* reader
          .table("sourceUnits")
          .index("by_org_connection_external", (q) =>
            q
              .eq("organizationKey", organizationKey)
              .eq("connectionKey", connection.connectionKey)
              .eq("connectionGeneration", connection.connectionGeneration),
          )
          .collect()
          .pipe(Effect.orDie)) as readonly HealthSourceUnit[];
        sourceUnits.push(...units);
      }
      const routes = (yield* reader
        .table("callRoutingProposals")
        .index("by_org_revision", (q) =>
          q.eq("organizationKey", organizationKey),
        )
        .collect()
        .pipe(Effect.orDie)) as readonly HealthRoute[];
      const now = yield* Clock.currentTimeMillis;
      return buildTranscriptConnectionHealth({
        now,
        connections,
        syncStates,
        sourceUnits,
        routes,
      });
    }),
);

export const makeTranscriptSyncImpl = () =>
  GroupImpl.make(databaseSchema, transcriptSync).pipe(
    Layer.provide(claimTranscriptSyncPageImpl),
    Layer.provide(commitTranscriptSyncPageImpl),
    Layer.provide(ingestTranscriptSyncPageImpl),
    Layer.provide(failTranscriptSyncPageImpl),
    Layer.provide(listTranscriptConnectionHealthImpl),
    GroupImpl.finalize,
  );

export default makeTranscriptSyncImpl();
