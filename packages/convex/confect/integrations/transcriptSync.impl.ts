import { transcriptProviders } from "@maestro-template/integrations/transcripts/providers";
import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import { currentAdminOrganizationKey } from "./transcriptConnections.impl";
import transcriptSync, {
  TranscriptSyncConnectionNotFound,
  TranscriptSyncFenceError,
} from "./transcriptSync.spec";

export { TranscriptSyncFenceError } from "./transcriptSync.spec";

export type TranscriptSyncStatus =
  "queued" | "syncing" | "ready" | "retry_wait" | "error" | "revoked";

export type TranscriptSyncErrorTag =
  "ProviderRateLimited" | "ProviderUnavailable" | "PermanentDecodeFailure";

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
    const permanent = input.errorTag === "PermanentDecodeFailure";
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
};
type HealthConnection = Pick<
  StoredConnection,
  | "providerConfigKey"
  | "organizationKey"
  | "connectionKey"
  | "connectionGeneration"
  | "status"
>;
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
    const state =
      connection.status === "authorizing"
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
      return buildTranscriptConnectionHealth({
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
    Layer.provide(failTranscriptSyncPageImpl),
    Layer.provide(listTranscriptConnectionHealthImpl),
    GroupImpl.finalize,
  );

export default makeTranscriptSyncImpl();
