import { FunctionImpl, GroupImpl } from "@confect/server";
import {
  createNangoConnectSession,
  verifyNangoConnection,
} from "@maestro-template/integrations/nango/connect";
import {
  discoverSlackChannels,
  fetchSlackSnapshot,
  SlackChannelMembershipRequired,
} from "@maestro-template/integrations/nango/slack";
import {
  discoverGoogleDriveFolders,
  discoverGoogleDrives,
  fetchGoogleDriveInventory,
} from "@maestro-template/integrations/nango/googleDrive";
import {
  discoverHubSpotAccount,
  fetchHubSpotInventory,
} from "@maestro-template/integrations/nango/hubspot";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import type { ProviderConnectionsDoc } from "../_generated/docs";
import databaseSchema from "../_generated/schema";
import refs from "../_generated/refs";
import {
  DatabaseReader,
  DatabaseWriter,
  MutationRunner,
  QueryRunner,
  Scheduler,
} from "../_generated/services";
import {
  requireWorkspaceAccess,
  requireWorkspaceActorAccess,
} from "../capabilities/_kit/workspaceAccess";
import { NotFound, ValidationFailed } from "../errors";
import { readNangoConnectConfig, readNangoProviderConfig } from "../shared/env";
import {
  beginConnection,
  completeConnection,
  providerKeys,
  revokeConnection,
  type ProviderConnectionState,
  type ProviderKey,
} from "./connectionLifecycle";
import connections from "./connections.spec";
import { buildSlackEvidenceItems } from "./slackSnapshot";

const withConfectClock = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, Exclude<R, Clock.Clock>> =>
  effect as Effect.Effect<A, E, Exclude<R, Clock.Clock>>;

type CurrentProviderConnectionDocument = Extract<
  ProviderConnectionsDoc,
  { readonly workspaceId: GenericId<"workspaces"> }
>;

const currentConnectionOrNull = (
  row: ProviderConnectionsDoc | null,
): CurrentProviderConnectionDocument | null =>
  row !== null && "workspaceId" in row ? row : null;

const requireCurrentConnectionRow = (
  row: ProviderConnectionsDoc | null,
  provider: ProviderKey,
) => {
  const current = currentConnectionOrNull(row);
  return current === null
    ? Effect.fail(
        new NotFound({ resource: "providerConnections", id: provider }),
      )
    : Effect.succeed(current);
};

const currentConnection = (
  workspaceId: GenericId<"workspaces">,
  provider: ProviderKey,
) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const row = yield* reader
      .table("providerConnections")
      .index("by_workspace_and_provider", (q) =>
        q.eq("workspaceId", workspaceId).eq("provider", provider),
      )
      .first()
      .pipe(Effect.map(Option.getOrNull), Effect.orDie);
    return currentConnectionOrNull(row);
  });

const toState = (row: {
  provider: ProviderKey;
  status: ProviderConnectionState["status"];
  generation: number;
  connectionRef?: string | undefined;
  errorCode?: string | undefined;
}): ProviderConnectionState => ({
  provider: row.provider,
  status: row.status,
  generation: row.generation,
  ...(row.connectionRef === undefined
    ? {}
    : { connectionRef: row.connectionRef }),
  ...(row.errorCode === undefined ? {} : { errorCode: row.errorCode }),
});

const transitionFailure = () =>
  new ValidationFailed({
    field: "generation",
    message: "Provider connection state changed. Refresh and try again.",
  });

const listConnectionRows = (workspaceId: GenericId<"workspaces">) =>
  Effect.gen(function* () {
    const reader = yield* DatabaseReader;
    const rows = yield* reader
      .table("providerConnections")
      .index("by_workspace", (q) => q.eq("workspaceId", workspaceId))
      .take(providerKeys.length + 1)
      .pipe(Effect.orDie);
    return rows.filter(
      (row): row is CurrentProviderConnectionDocument =>
        currentConnectionOrNull(row) !== null,
    );
  });

const connectionForSync = FunctionImpl.make(
  databaseSchema,
  connections,
  "connectionForSync",
  ({ workspaceId, provider }) => currentConnection(workspaceId, provider),
);

const beginConnectionRow = (
  workspaceId: GenericId<"workspaces">,
  provider: ProviderKey,
) =>
  Effect.gen(function* () {
    const existing = yield* currentConnection(workspaceId, provider);
    const state = beginConnection(
      existing === null ? undefined : toState(existing),
      provider,
    );
    const now = yield* withConfectClock(Clock.currentTimeMillis);
    const writer = yield* DatabaseWriter;
    if (existing === null) {
      const id = yield* writer
        .table("providerConnections")
        .insert({ workspaceId, ...state, createdAt: now, updatedAt: now })
        .pipe(Effect.orDie);
      const reader = yield* DatabaseReader;
      const inserted = yield* reader
        .table("providerConnections")
        .get(id)
        .pipe(Effect.orDie);
      return yield* requireCurrentConnectionRow(inserted, provider);
    } else {
      yield* writer
        .table("providerConnections")
        .patch(existing._id, {
          status: state.status,
          generation: state.generation,
          connectionRef: undefined,
          errorCode: undefined,
          scheduledSyncEnabled: undefined,
          slackChannelIds: undefined,
          googleDriveId: undefined,
          googleDriveRootFolderIds: undefined,
          hubSpotPortalId: undefined,
          syncAllowlistGeneration: undefined,
          updatedAt: now,
        })
        .pipe(Effect.orDie);
      const reader = yield* DatabaseReader;
      const updated = yield* reader
        .table("providerConnections")
        .get(existing._id)
        .pipe(Effect.orDie);
      return yield* requireCurrentConnectionRow(updated, provider);
    }
  });

const completeConnectionRow = (args: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly provider: ProviderKey;
  readonly generation: number;
  readonly completion:
    | { readonly status: "active"; readonly connectionRef: string }
    | { readonly status: "error"; readonly errorCode: string };
}) =>
  Effect.gen(function* () {
    const existing = yield* currentConnection(args.workspaceId, args.provider);
    if (existing === null) {
      return yield* new NotFound({
        resource: "providerConnections",
        id: args.provider,
      });
    }
    const current = toState(existing);
    const state = yield* Effect.try({
      try: () =>
        completeConnection(current, {
          generation: args.generation,
          ...args.completion,
        }),
      catch: () => transitionFailure(),
    });
    if (state === current) return existing;
    const now = yield* withConfectClock(Clock.currentTimeMillis);
    const writer = yield* DatabaseWriter;
    yield* writer
      .table("providerConnections")
      .patch(existing._id, {
        status: state.status,
        connectionRef: state.connectionRef,
        errorCode: state.errorCode,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const reader = yield* DatabaseReader;
    const updated = yield* reader
      .table("providerConnections")
      .get(existing._id)
      .pipe(Effect.orDie);
    return currentConnectionOrNull(updated) ?? existing;
  });

const revokeConnectionRow = (args: {
  readonly workspaceId: GenericId<"workspaces">;
  readonly provider: ProviderKey;
  readonly generation: number;
}) =>
  Effect.gen(function* () {
    const existing = yield* currentConnection(args.workspaceId, args.provider);
    if (existing === null) {
      return yield* new NotFound({
        resource: "providerConnections",
        id: args.provider,
      });
    }
    const current = toState(existing);
    const state = yield* Effect.try({
      try: () => revokeConnection(current, args.generation),
      catch: () => transitionFailure(),
    });
    if (state === current) return existing;
    const now = yield* withConfectClock(Clock.currentTimeMillis);
    const writer = yield* DatabaseWriter;
    yield* writer
      .table("providerConnections")
      .patch(existing._id, {
        status: "revoked",
        connectionRef: undefined,
        errorCode: undefined,
        updatedAt: now,
      })
      .pipe(Effect.orDie);
    const reader = yield* DatabaseReader;
    const updated = yield* reader
      .table("providerConnections")
      .get(existing._id)
      .pipe(Effect.orDie);
    return currentConnectionOrNull(updated) ?? existing;
  });

const list = FunctionImpl.make(
  databaseSchema,
  connections,
  "list",
  ({ workspaceId }) =>
    Effect.gen(function* () {
      yield* withConfectClock(requireWorkspaceAccess(workspaceId, "viewer"));
      return yield* listConnectionRows(workspaceId);
    }),
);

const begin = FunctionImpl.make(
  databaseSchema,
  connections,
  "begin",
  ({ workspaceId, provider }) =>
    Effect.gen(function* () {
      yield* withConfectClock(requireWorkspaceAccess(workspaceId, "editor"));
      return yield* beginConnectionRow(workspaceId, provider);
    }),
);

const providerFailure = () =>
  new ValidationFailed({
    field: "provider",
    message: "Provider authorization is temporarily unavailable. Try again.",
  });

const slackSyncFailure = (error: unknown) =>
  error instanceof SlackChannelMembershipRequired
    ? new ValidationFailed({ field: "channelIds", message: error.message })
    : providerFailure();

const beginSlackOauth = FunctionImpl.make(
  databaseSchema,
  connections,
  "beginSlackOauth",
  ({ workspaceId }) =>
    Effect.gen(function* () {
      const runMutation = yield* MutationRunner;
      const begun = yield* runMutation(
        refs.public.integrations.connections.begin,
        { workspaceId, provider: "slack" },
      ).pipe(Effect.catchTag("SchemaError", providerFailure));
      const config = readNangoConnectConfig();
      if (config === undefined) {
        yield* runMutation(refs.public.integrations.connections.complete, {
          workspaceId,
          provider: "slack",
          generation: begun.generation,
          completion: { status: "error", errorCode: "provider_unavailable" },
        }).pipe(Effect.ignore);
        return yield* providerFailure();
      }
      const now = yield* Clock.currentTimeMillis;
      const session = yield* Effect.tryPromise({
        try: () =>
          createNangoConnectSession({
            ...config,
            workspaceId,
            generation: begun.generation,
            now,
          }),
        catch: providerFailure,
      }).pipe(
        Effect.tapError(() =>
          runMutation(refs.public.integrations.connections.complete, {
            workspaceId,
            provider: "slack",
            generation: begun.generation,
            completion: { status: "error", errorCode: "provider_unavailable" },
          }).pipe(Effect.ignore),
        ),
      );
      return { ...session, generation: begun.generation };
    }),
);

const beginProviderOauth = FunctionImpl.make(
  databaseSchema,
  connections,
  "beginProviderOauth",
  ({ workspaceId, provider }) =>
    Effect.gen(function* () {
      const runMutation = yield* MutationRunner;
      const begun = yield* runMutation(
        refs.public.integrations.connections.begin,
        { workspaceId, provider },
      ).pipe(Effect.catchTag("SchemaError", providerFailure));
      const config = readNangoProviderConfig(provider);
      if (config === undefined) {
        yield* runMutation(refs.public.integrations.connections.complete, {
          workspaceId,
          provider,
          generation: begun.generation,
          completion: { status: "error", errorCode: "provider_unavailable" },
        }).pipe(Effect.ignore);
        return yield* providerFailure();
      }
      const now = yield* Clock.currentTimeMillis;
      const session = yield* Effect.tryPromise({
        try: () =>
          createNangoConnectSession({
            ...config,
            workspaceId,
            generation: begun.generation,
            now,
          }),
        catch: providerFailure,
      }).pipe(
        Effect.tapError(() =>
          runMutation(refs.public.integrations.connections.complete, {
            workspaceId,
            provider,
            generation: begun.generation,
            completion: {
              status: "error",
              errorCode: "provider_unavailable",
            },
          }).pipe(Effect.ignore),
        ),
      );
      return { ...session, generation: begun.generation };
    }),
);

const completeSlackOauth = FunctionImpl.make(
  databaseSchema,
  connections,
  "completeSlackOauth",
  ({ workspaceId, generation, connectionId }) =>
    Effect.gen(function* () {
      const config = readNangoConnectConfig();
      if (config === undefined) return yield* providerFailure();
      const runMutation = yield* MutationRunner;
      yield* Effect.tryPromise({
        try: () =>
          verifyNangoConnection({
            ...config,
            workspaceId,
            generation,
            connectionId,
          }),
        catch: providerFailure,
      }).pipe(
        Effect.tapError(() =>
          runMutation(refs.public.integrations.connections.complete, {
            workspaceId,
            provider: "slack",
            generation,
            completion: { status: "error", errorCode: "verification_failed" },
          }).pipe(Effect.ignore),
        ),
      );
      return yield* runMutation(refs.public.integrations.connections.complete, {
        workspaceId,
        provider: "slack",
        generation,
        completion: { status: "active", connectionRef: connectionId },
      }).pipe(Effect.catchTag("SchemaError", providerFailure));
    }),
);

const completeProviderOauth = FunctionImpl.make(
  databaseSchema,
  connections,
  "completeProviderOauth",
  ({ workspaceId, provider, generation, connectionId }) =>
    Effect.gen(function* () {
      const config = readNangoProviderConfig(provider);
      if (config === undefined) return yield* providerFailure();
      const runMutation = yield* MutationRunner;
      yield* Effect.tryPromise({
        try: () =>
          verifyNangoConnection({
            ...config,
            workspaceId,
            generation,
            connectionId,
          }),
        catch: providerFailure,
      }).pipe(
        Effect.tapError(() =>
          runMutation(refs.public.integrations.connections.complete, {
            workspaceId,
            provider,
            generation,
            completion: { status: "error", errorCode: "verification_failed" },
          }).pipe(Effect.ignore),
        ),
      );
      return yield* runMutation(refs.public.integrations.connections.complete, {
        workspaceId,
        provider,
        generation,
        completion: { status: "active", connectionRef: connectionId },
      }).pipe(Effect.catchTag("SchemaError", providerFailure));
    }),
);

const discoverProviderScopes = FunctionImpl.make(
  databaseSchema,
  connections,
  "discoverProviderScopes",
  ({ workspaceId, provider, containerId }) =>
    Effect.gen(function* () {
      const query = yield* QueryRunner;
      const rows = yield* query(refs.public.integrations.connections.list, {
        workspaceId,
      }).pipe(Effect.catchTag("SchemaError", providerFailure));
      const connection = yield* requireActiveConnection(rows, provider);
      const config =
        provider === "slack"
          ? readNangoConnectConfig()
          : readNangoProviderConfig(provider);
      if (config === undefined) return yield* providerFailure();
      const connectionId = connection.connectionRef as string;
      return yield* Effect.tryPromise({
        try: async () => {
          if (provider === "slack") {
            const channels = await discoverSlackChannels({
              ...config,
              connectionId,
              maxChannels: 500,
            });
            return {
              provider,
              containers: [],
              scopes: channels.map((channel) => ({
                id: channel.id,
                label: `#${channel.name}`,
                ...(!channel.isMember
                  ? {
                      description: channel.isPrivate
                        ? "Private channel · invite Maestro Brain before syncing"
                        : "Maestro Brain will join this public channel when sync starts",
                    }
                  : channel.isPrivate
                    ? { description: "Private channel" }
                    : {}),
              })),
            };
          }
          if (provider === "google-drive") {
            const drives = await discoverGoogleDrives({
              ...config,
              connectionId,
              maxDrives: 100,
            });
            const selectedDrive =
              containerId === undefined
                ? undefined
                : drives.find(({ id }) => id === containerId);
            if (containerId !== undefined && selectedDrive === undefined)
              return Promise.reject(
                new Error("Selected Shared Drive is unavailable."),
              );
            const folders =
              selectedDrive === undefined
                ? []
                : await discoverGoogleDriveFolders({
                    ...config,
                    connectionId,
                    driveId: selectedDrive.id,
                    maxFolders: 500,
                  });
            return {
              provider,
              containers: drives.map((drive) => ({
                id: drive.id,
                label: drive.name,
              })),
              scopes:
                selectedDrive === undefined
                  ? []
                  : [
                      {
                        id: selectedDrive.id,
                        label: "Entire Shared Drive",
                        description: selectedDrive.name,
                      },
                      ...folders.map((folder) => ({
                        id: folder.id,
                        label: folder.name,
                        description: "Folder",
                      })),
                    ],
              ...(selectedDrive === undefined
                ? {}
                : { resolvedContainerId: selectedDrive.id }),
            };
          }
          const account = await discoverHubSpotAccount({
            ...config,
            connectionId,
          });
          return {
            provider,
            containers: [{ id: account.portalId, label: account.displayName }],
            scopes: [],
            resolvedContainerId: account.portalId,
          };
        },
        catch: providerFailure,
      });
    }),
);

const activeConnectionFromRows = (
  rows: readonly ProviderConnectionsDoc[],
  provider: ProviderKey,
): CurrentProviderConnectionDocument | undefined =>
  rows
    .flatMap((row) => {
      const current = currentConnectionOrNull(row);
      return current === null ? [] : [current];
    })
    .find(
      (row) =>
        row.provider === provider &&
        row.status === "active" &&
        typeof row.connectionRef === "string",
    );

const requireActiveConnection = (
  rows: readonly ProviderConnectionsDoc[],
  provider: ProviderKey,
) => {
  const connection = activeConnectionFromRows(rows, provider);
  return connection === undefined
    ? Effect.fail(
        new ValidationFailed({
          field: "provider",
          message: `Connect ${provider} before synchronizing it.`,
        }),
      )
    : Effect.succeed(connection);
};

const scheduledConnectionRows = (
  workspaceId: GenericId<"workspaces">,
  provider: ProviderKey,
) =>
  Effect.gen(function* () {
    const query = yield* QueryRunner;
    const connection = yield* query(
      refs.internal.integrations.connections.connectionForSync,
      { workspaceId, provider },
    ).pipe(Effect.catchTag("SchemaError", providerFailure));
    return connection === null ? [] : [connection];
  });

const driveMarkdown = (
  observation: Awaited<
    ReturnType<typeof fetchGoogleDriveInventory>
  >["observations"][number],
) =>
  [
    `# ${observation.metadata.name}`,
    "",
    `- MIME type: ${observation.metadata.mimeType}`,
    `- Drive: ${observation.metadata.driveId}`,
    `- Modified: ${new Date(observation.sourceModifiedAt).toISOString()}`,
    `- Source: ${observation.sourceLocator}`,
    ...(observation.metadata.version === null
      ? []
      : [`- Provider version: ${observation.metadata.version}`]),
    ...(observation.metadata.contentText === null
      ? ["", "> Content extraction is not available for this MIME type."]
      : ["", "## Content", "", observation.metadata.contentText]),
  ].join("\n");

const hubSpotMarkdown = (
  observation: Awaited<
    ReturnType<typeof fetchHubSpotInventory>
  >["observations"][number],
) =>
  [
    `# HubSpot ${observation.metadata.objectType} ${observation.providerObjectId}`,
    "",
    ...Object.entries(observation.metadata.properties).map(
      ([key, value]) => `- ${key}: ${value ?? ""}`,
    ),
    `- Source: ${observation.sourceLocator}`,
  ].join("\n");

const runGoogleDriveSync = (
  {
    workspaceId,
    driveId,
    rootFolderIds,
    allowlistGeneration,
  }: {
    readonly workspaceId: GenericId<"workspaces">;
    readonly driveId: string;
    readonly rootFolderIds: readonly string[];
    readonly allowlistGeneration?: number | undefined;
  },
  rows: readonly ProviderConnectionsDoc[],
) =>
  Effect.gen(function* () {
    const config = readNangoProviderConfig("google-drive");
    if (config === undefined) return yield* providerFailure();
    const mutation = yield* MutationRunner;
    const connection = yield* requireActiveConnection(rows, "google-drive");
    yield* mutation(refs.internal.integrations.connections.recordProviderSync, {
      workspaceId,
      provider: "google-drive",
      status: "syncing",
      driveId,
      rootFolderIds,
      allowlistGeneration: allowlistGeneration ?? 1,
    }).pipe(Effect.catchTag("SchemaError", providerFailure));
    const observedAt = yield* Clock.currentTimeMillis;
    const runKey = `google-drive:${connection.generation}:${observedAt}`;
    return yield* Effect.gen(function* () {
      const inventory = yield* Effect.tryPromise({
        try: () =>
          fetchGoogleDriveInventory({
            ...config,
            connectionId: connection.connectionRef as string,
            connectionGeneration: connection.generation,
            driveId,
            rootFolderIds,
            allowlistGeneration: allowlistGeneration ?? 1,
            observedAt,
            limits: { maxSources: 1_000 },
          }),
        catch: providerFailure,
      });
      yield* mutation(refs.internal.brain.evidence.beginRun, {
        workspaceId,
        provider: "google_drive",
        scopeKey: inventory.scope.scopeKey,
        runKey,
        startedAt: observedAt,
      }).pipe(Effect.catchTag("SchemaError", providerFailure));
      const active = inventory.observations.filter(
        ({ tombstone }) => !tombstone,
      );
      for (const observation of active)
        yield* mutation(refs.internal.brain.evidence.publishRunItem, {
          workspaceId,
          provider: "google_drive",
          scopeKey: inventory.scope.scopeKey,
          runKey,
          sourceKey: observation.sourceKey,
          revisionKey: observation.revisionKey,
          title: observation.metadata.name,
          markdown: driveMarkdown(observation),
          locator: observation.sourceLocator,
          sourceModifiedAt: observation.sourceModifiedAt,
          observedAt: observation.observedAt,
        }).pipe(Effect.catchTag("SchemaError", providerFailure));
      yield* mutation(refs.internal.brain.evidence.completeRun, {
        workspaceId,
        runKey,
        discoveredCount: active.length,
        completedAt: inventory.completedAt,
      }).pipe(Effect.catchTag("SchemaError", providerFailure));
      yield* mutation(
        refs.internal.integrations.connections.recordProviderSync,
        {
          workspaceId,
          provider: "google-drive",
          status: "ready",
          syncedAt: inventory.completedAt,
          sourceCount: active.length,
        },
      ).pipe(Effect.catchTag("SchemaError", providerFailure));
      return { sourceCount: active.length, syncedAt: inventory.completedAt };
    }).pipe(
      Effect.tapError(() =>
        Effect.all([
          mutation(refs.internal.brain.evidence.failRun, {
            workspaceId,
            runKey,
            failureCode: "google_drive_sync_failed",
            failedAt: observedAt,
          }).pipe(Effect.ignore),
          mutation(refs.internal.integrations.connections.recordProviderSync, {
            workspaceId,
            provider: "google-drive",
            status: "error",
            errorCode: "google_drive_sync_failed",
          }).pipe(Effect.ignore),
        ]),
      ),
    );
  });

const syncGoogleDrive = FunctionImpl.make(
  databaseSchema,
  connections,
  "syncGoogleDrive",
  (args) =>
    Effect.gen(function* () {
      const query = yield* QueryRunner;
      const rows = yield* query(refs.public.integrations.connections.list, {
        workspaceId: args.workspaceId,
      }).pipe(Effect.catchTag("SchemaError", providerFailure));
      return yield* runGoogleDriveSync(args, rows);
    }),
);

const syncGoogleDriveScheduled = FunctionImpl.make(
  databaseSchema,
  connections,
  "syncGoogleDriveScheduled",
  (args) =>
    Effect.gen(function* () {
      const rows = yield* scheduledConnectionRows(
        args.workspaceId,
        "google-drive",
      );
      return yield* runGoogleDriveSync(args, rows);
    }),
);

const runHubSpotSync = (
  {
    workspaceId,
    portalId,
    allowlistGeneration,
  }: {
    readonly workspaceId: GenericId<"workspaces">;
    readonly portalId: string;
    readonly allowlistGeneration?: number | undefined;
  },
  rows: readonly ProviderConnectionsDoc[],
) =>
  Effect.gen(function* () {
    const config = readNangoProviderConfig("hubspot");
    if (config === undefined) return yield* providerFailure();
    const mutation = yield* MutationRunner;
    const connection = yield* requireActiveConnection(rows, "hubspot");
    yield* mutation(refs.internal.integrations.connections.recordProviderSync, {
      workspaceId,
      provider: "hubspot",
      status: "syncing",
      portalId,
      allowlistGeneration: allowlistGeneration ?? 1,
    }).pipe(Effect.catchTag("SchemaError", providerFailure));
    const observedAt = yield* Clock.currentTimeMillis;
    const runKey = `hubspot:${connection.generation}:${observedAt}`;
    return yield* Effect.gen(function* () {
      const inventory = yield* Effect.tryPromise({
        try: () =>
          fetchHubSpotInventory({
            ...config,
            connectionId: connection.connectionRef as string,
            connectionGeneration: connection.generation,
            portalId,
            allowlistGeneration: allowlistGeneration ?? 1,
            observedAt,
            limits: { maxSources: 1_000 },
          }),
        catch: providerFailure,
      });
      yield* mutation(refs.internal.brain.evidence.beginRun, {
        workspaceId,
        provider: "hubspot",
        scopeKey: inventory.scope.scopeKey,
        runKey,
        startedAt: observedAt,
      }).pipe(Effect.catchTag("SchemaError", providerFailure));
      const active = inventory.observations.filter(
        ({ tombstone }) => !tombstone,
      );
      for (const observation of active)
        yield* mutation(refs.internal.brain.evidence.publishRunItem, {
          workspaceId,
          provider: "hubspot",
          scopeKey: inventory.scope.scopeKey,
          runKey,
          sourceKey: observation.sourceKey,
          revisionKey: observation.revisionKey,
          title: `${observation.metadata.objectType} ${observation.providerObjectId}`,
          markdown: hubSpotMarkdown(observation),
          locator: observation.sourceLocator,
          sourceModifiedAt: observation.sourceModifiedAt,
          observedAt: observation.observedAt,
        }).pipe(Effect.catchTag("SchemaError", providerFailure));
      yield* mutation(refs.internal.brain.evidence.completeRun, {
        workspaceId,
        runKey,
        discoveredCount: active.length,
        completedAt: inventory.completedAt,
      }).pipe(Effect.catchTag("SchemaError", providerFailure));
      yield* mutation(
        refs.internal.integrations.connections.recordProviderSync,
        {
          workspaceId,
          provider: "hubspot",
          status: "ready",
          syncedAt: inventory.completedAt,
          sourceCount: active.length,
        },
      ).pipe(Effect.catchTag("SchemaError", providerFailure));
      return { sourceCount: active.length, syncedAt: inventory.completedAt };
    }).pipe(
      Effect.tapError(() =>
        Effect.all([
          mutation(refs.internal.brain.evidence.failRun, {
            workspaceId,
            runKey,
            failureCode: "hubspot_sync_failed",
            failedAt: observedAt,
          }).pipe(Effect.ignore),
          mutation(refs.internal.integrations.connections.recordProviderSync, {
            workspaceId,
            provider: "hubspot",
            status: "error",
            errorCode: "hubspot_sync_failed",
          }).pipe(Effect.ignore),
        ]),
      ),
    );
  });

const syncHubSpot = FunctionImpl.make(
  databaseSchema,
  connections,
  "syncHubSpot",
  (args) =>
    Effect.gen(function* () {
      const query = yield* QueryRunner;
      const rows = yield* query(refs.public.integrations.connections.list, {
        workspaceId: args.workspaceId,
      }).pipe(Effect.catchTag("SchemaError", providerFailure));
      return yield* runHubSpotSync(args, rows);
    }),
);

const syncHubSpotScheduled = FunctionImpl.make(
  databaseSchema,
  connections,
  "syncHubSpotScheduled",
  (args) =>
    Effect.gen(function* () {
      const rows = yield* scheduledConnectionRows(args.workspaceId, "hubspot");
      return yield* runHubSpotSync(args, rows);
    }),
);

const runSlackSync = (
  {
    workspaceId,
    channelIds,
  }: {
    readonly workspaceId: GenericId<"workspaces">;
    readonly channelIds: readonly string[];
  },
  rows: readonly ProviderConnectionsDoc[],
) =>
  Effect.gen(function* () {
    const config = readNangoConnectConfig();
    if (config === undefined) return yield* providerFailure();
    const mutation = yield* MutationRunner;
    const connection = yield* requireActiveConnection(rows, "slack");
    yield* mutation(refs.internal.integrations.connections.recordSlackSync, {
      workspaceId,
      status: "syncing",
      channelIds,
    }).pipe(Effect.catchTag("SchemaError", providerFailure));
    const startedAt = yield* Clock.currentTimeMillis;
    const runKey = `slack:${connection.generation}:${startedAt}`;
    const scopeKey = `slack:${connection.connectionRef}`;
    yield* mutation(refs.internal.brain.evidence.beginRun, {
      workspaceId,
      provider: "slack",
      scopeKey,
      runKey,
      startedAt,
    }).pipe(Effect.catchTag("SchemaError", providerFailure));
    return yield* Effect.gen(function* () {
      const snapshot = yield* Effect.tryPromise({
        try: () =>
          fetchSlackSnapshot({
            ...config,
            connectionId: connection.connectionRef as string,
            channelIds,
            limits: { maxMessagesTotal: 1_000 },
          }),
        catch: slackSyncFailure,
      });
      const syncedAt = yield* Clock.currentTimeMillis;
      const items = buildSlackEvidenceItems(snapshot, {
        workspaceId,
        connectionRef: connection.connectionRef as string,
        runKey,
        observedAt: syncedAt,
      });
      for (const item of items)
        yield* mutation(refs.internal.brain.evidence.publishRunItem, item).pipe(
          Effect.catchTag("SchemaError", providerFailure),
        );
      yield* mutation(refs.internal.brain.evidence.completeRun, {
        workspaceId,
        runKey,
        discoveredCount: items.length,
        completedAt: syncedAt,
      }).pipe(Effect.catchTag("SchemaError", providerFailure));
      yield* mutation(refs.internal.integrations.connections.recordSlackSync, {
        workspaceId,
        status: "ready",
        syncedAt,
        messageCount: snapshot.messageCount,
        pageCount: snapshot.channels.length,
      }).pipe(Effect.catchTag("SchemaError", providerFailure));
      return {
        pageCount: snapshot.channels.length,
        messageCount: snapshot.messageCount,
        syncedAt,
      };
    }).pipe(
      Effect.tapError(() =>
        Effect.all([
          mutation(refs.internal.brain.evidence.failRun, {
            workspaceId,
            runKey,
            failureCode: "slack_sync_failed",
            failedAt: startedAt,
          }).pipe(Effect.ignore),
          mutation(refs.internal.integrations.connections.recordSlackSync, {
            workspaceId,
            status: "error",
            errorCode: "slack_sync_failed",
          }).pipe(Effect.ignore),
        ]),
      ),
    );
  });

const syncSlack = FunctionImpl.make(
  databaseSchema,
  connections,
  "syncSlack",
  (args) =>
    Effect.gen(function* () {
      const query = yield* QueryRunner;
      const rows = yield* query(refs.public.integrations.connections.list, {
        workspaceId: args.workspaceId,
      }).pipe(Effect.catchTag("SchemaError", providerFailure));
      return yield* runSlackSync(args, rows);
    }),
);

const syncSlackScheduled = FunctionImpl.make(
  databaseSchema,
  connections,
  "syncSlackScheduled",
  (args) =>
    Effect.gen(function* () {
      const rows = yield* scheduledConnectionRows(args.workspaceId, "slack");
      return yield* runSlackSync(args, rows);
    }),
);

const recordSlackSync = FunctionImpl.make(
  databaseSchema,
  connections,
  "recordSlackSync",
  ({
    workspaceId,
    status,
    syncedAt,
    messageCount,
    pageCount,
    channelIds,
    errorCode,
  }) =>
    Effect.gen(function* () {
      const connection = yield* currentConnection(workspaceId, "slack");
      if (connection === null) {
        return yield* new NotFound({
          resource: "providerConnections",
          id: "slack",
        });
      }
      const now = yield* withConfectClock(Clock.currentTimeMillis);
      yield* (yield* DatabaseWriter)
        .table("providerConnections")
        .patch(connection._id, {
          syncStatus: status,
          syncErrorCode: errorCode,
          ...(channelIds === undefined
            ? {}
            : {
                scheduledSyncEnabled: true,
                slackChannelIds: [...new Set(channelIds)].sort(),
              }),
          ...(syncedAt === undefined ? {} : { lastSyncedAt: syncedAt }),
          ...(messageCount === undefined
            ? {}
            : { lastSyncMessageCount: messageCount }),
          ...(pageCount === undefined ? {} : { lastSyncPageCount: pageCount }),
          updatedAt: now,
        })
        .pipe(Effect.orDie);
      const updated = yield* (yield* DatabaseReader)
        .table("providerConnections")
        .get(connection._id)
        .pipe(Effect.orDie);
      return yield* requireCurrentConnectionRow(updated, "slack");
    }),
);

const recordProviderSync = FunctionImpl.make(
  databaseSchema,
  connections,
  "recordProviderSync",
  ({
    workspaceId,
    provider,
    status,
    syncedAt,
    sourceCount,
    driveId,
    rootFolderIds,
    portalId,
    allowlistGeneration,
    errorCode,
  }) =>
    Effect.gen(function* () {
      const connection = yield* currentConnection(workspaceId, provider);
      if (connection === null)
        return yield* new NotFound({
          resource: "providerConnections",
          id: provider,
        });
      const now = yield* withConfectClock(Clock.currentTimeMillis);
      yield* (yield* DatabaseWriter)
        .table("providerConnections")
        .patch(connection._id, {
          syncStatus: status,
          syncErrorCode: errorCode,
          ...(driveId === undefined || rootFolderIds === undefined
            ? {}
            : {
                scheduledSyncEnabled: true,
                googleDriveId: driveId,
                googleDriveRootFolderIds: [...new Set(rootFolderIds)].sort(),
                syncAllowlistGeneration: allowlistGeneration ?? 1,
              }),
          ...(portalId === undefined
            ? {}
            : {
                scheduledSyncEnabled: true,
                hubSpotPortalId: portalId,
                syncAllowlistGeneration: allowlistGeneration ?? 1,
              }),
          ...(syncedAt === undefined ? {} : { lastSyncedAt: syncedAt }),
          ...(sourceCount === undefined
            ? {}
            : { lastSyncSourceCount: sourceCount }),
          updatedAt: now,
        })
        .pipe(Effect.orDie);
      const updated = yield* (yield* DatabaseReader)
        .table("providerConnections")
        .get(connection._id)
        .pipe(Effect.orDie);
      return yield* requireCurrentConnectionRow(updated, provider);
    }),
);

const SCHEDULED_CONNECTION_LIMIT = 200;

const dispatchScheduledSyncs = FunctionImpl.make(
  databaseSchema,
  connections,
  "dispatchScheduledSyncs",
  () =>
    Effect.gen(function* () {
      const rows = yield* (yield* DatabaseReader)
        .table("providerConnections")
        .index("by_status", (q) => q.eq("status", "active"))
        .take(SCHEDULED_CONNECTION_LIMIT + 1)
        .pipe(Effect.orDie);
      if (rows.length > SCHEDULED_CONNECTION_LIMIT)
        return yield* new ValidationFailed({
          field: "providerConnections",
          message:
            "Scheduled connector capacity was exceeded; partition the dispatcher before enabling more connections.",
        });
      const scheduler = yield* Scheduler;
      let scheduledCount = 0;
      let skippedCount = 0;
      for (const row of rows) {
        const connection = currentConnectionOrNull(row);
        if (
          connection === null ||
          connection.scheduledSyncEnabled !== true ||
          connection.syncStatus === "syncing"
        ) {
          skippedCount += 1;
          continue;
        }
        if (
          connection.provider === "slack" &&
          connection.slackChannelIds !== undefined &&
          connection.slackChannelIds.length > 0
        ) {
          yield* scheduler
            .runAfter(
              Duration.zero,
              refs.internal.integrations.connections.syncSlackScheduled,
              {
                workspaceId: connection.workspaceId,
                channelIds: connection.slackChannelIds,
              },
            )
            .pipe(Effect.orDie);
          scheduledCount += 1;
          continue;
        }
        if (
          connection.provider === "google-drive" &&
          connection.googleDriveId !== undefined &&
          connection.googleDriveRootFolderIds !== undefined &&
          connection.googleDriveRootFolderIds.length > 0
        ) {
          yield* scheduler
            .runAfter(
              Duration.zero,
              refs.internal.integrations.connections.syncGoogleDriveScheduled,
              {
                workspaceId: connection.workspaceId,
                driveId: connection.googleDriveId,
                rootFolderIds: connection.googleDriveRootFolderIds,
                allowlistGeneration: connection.syncAllowlistGeneration ?? 1,
              },
            )
            .pipe(Effect.orDie);
          scheduledCount += 1;
          continue;
        }
        if (
          connection.provider === "hubspot" &&
          connection.hubSpotPortalId !== undefined
        ) {
          yield* scheduler
            .runAfter(
              Duration.zero,
              refs.internal.integrations.connections.syncHubSpotScheduled,
              {
                workspaceId: connection.workspaceId,
                portalId: connection.hubSpotPortalId,
                allowlistGeneration: connection.syncAllowlistGeneration ?? 1,
              },
            )
            .pipe(Effect.orDie);
          scheduledCount += 1;
          continue;
        }
        skippedCount += 1;
      }
      return { scheduledCount, skippedCount };
    }),
);

const complete = FunctionImpl.make(
  databaseSchema,
  connections,
  "complete",
  (args) =>
    Effect.gen(function* () {
      yield* withConfectClock(
        requireWorkspaceAccess(args.workspaceId, "editor"),
      );
      return yield* completeConnectionRow(args);
    }),
);

const revoke = FunctionImpl.make(
  databaseSchema,
  connections,
  "revoke",
  ({ workspaceId, provider, generation }) =>
    Effect.gen(function* () {
      yield* withConfectClock(requireWorkspaceAccess(workspaceId, "editor"));
      return yield* revokeConnectionRow({ workspaceId, provider, generation });
    }),
);

const listForActor = FunctionImpl.make(
  databaseSchema,
  connections,
  "listForActor",
  ({ workspaceId, userId }) =>
    Effect.gen(function* () {
      yield* withConfectClock(
        requireWorkspaceActorAccess(workspaceId, userId, "viewer"),
      );
      return yield* listConnectionRows(workspaceId);
    }),
);

const beginForActor = FunctionImpl.make(
  databaseSchema,
  connections,
  "beginForActor",
  ({ workspaceId, userId, provider }) =>
    Effect.gen(function* () {
      yield* withConfectClock(
        requireWorkspaceActorAccess(workspaceId, userId, "editor"),
      );
      return yield* beginConnectionRow(workspaceId, provider);
    }),
);

const completeForActor = FunctionImpl.make(
  databaseSchema,
  connections,
  "completeForActor",
  ({ userId, ...args }) =>
    Effect.gen(function* () {
      yield* withConfectClock(
        requireWorkspaceActorAccess(args.workspaceId, userId, "editor"),
      );
      return yield* completeConnectionRow(args);
    }),
);

const revokeForActor = FunctionImpl.make(
  databaseSchema,
  connections,
  "revokeForActor",
  ({ workspaceId, userId, provider, generation }) =>
    Effect.gen(function* () {
      yield* withConfectClock(
        requireWorkspaceActorAccess(workspaceId, userId, "editor"),
      );
      return yield* revokeConnectionRow({ workspaceId, provider, generation });
    }),
);

const connectionGroup = GroupImpl.make(databaseSchema, connections).pipe(
  Layer.provide(list),
  Layer.provide(begin),
  Layer.provide(beginSlackOauth),
  Layer.provide(beginProviderOauth),
  Layer.provide(completeSlackOauth),
  Layer.provide(completeProviderOauth),
  Layer.provide(discoverProviderScopes),
  Layer.provide(syncSlack),
  Layer.provide(syncSlackScheduled),
  Layer.provide(syncGoogleDrive),
  Layer.provide(syncGoogleDriveScheduled),
  Layer.provide(syncHubSpot),
  Layer.provide(syncHubSpotScheduled),
  Layer.provide(connectionForSync),
  Layer.provide(dispatchScheduledSyncs),
);

export default connectionGroup.pipe(
  Layer.provide(recordSlackSync),
  Layer.provide(recordProviderSync),
  Layer.provide(complete),
  Layer.provide(revoke),
  Layer.provide(listForActor),
  Layer.provide(beginForActor),
  Layer.provide(completeForActor),
  Layer.provide(revokeForActor),
  GroupImpl.finalize,
);
