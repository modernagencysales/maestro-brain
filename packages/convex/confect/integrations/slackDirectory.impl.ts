import { Ref } from "@confect/core";
import { DatabaseSchema, FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Clock from "effect/Clock";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import {
  DatabaseReader,
  DatabaseWriter,
  MutationRunner,
  QueryRunner,
} from "../_generated/services";
import type { ProviderConnectionRow } from "./slackConnections.impl";
import slackDirectory, {
  BotIdentityMismatch,
  ConnectionGenerationMismatch,
  ConnectionNotFound,
  ProviderRateLimited,
  ProviderUnavailable,
  commitInitialReconcileFailure,
  commitReconcileChannels,
  commitReconcileIdentity,
  readReconcileConnection,
} from "./slackDirectory.spec";
import channelSyncStatesSource, {
  type ChannelSyncStateRowValue,
} from "../tables/channelSyncStates";
import sourceChannelsSource, {
  type SourceChannelRowValue,
} from "../tables/sourceChannels";

const sourceChannels = sourceChannelsSource("sourceChannels");
const channelSyncStates = channelSyncStatesSource("channelSyncStates");

export const slackDirectoryDatabaseSchema = DatabaseSchema.make({
  ...databaseSchema.tables,
  sourceChannels,
  channelSyncStates,
});

type SlackDirectoryConnection = Pick<
  ProviderConnectionRow,
  | "organizationKey"
  | "connectionKey"
  | "connectionGeneration"
  | "status"
  | "teamId"
  | "apiAppId"
  | "botUserId"
  | "nangoConnectionId"
> & { readonly _id?: GenericId<"providerConnections"> | string };

export type ProviderSlackChannel = {
  readonly id: string;
  readonly name: string;
  readonly is_member: boolean;
  readonly is_shared?: boolean | undefined;
  readonly is_ext_shared?: boolean | undefined;
  readonly is_archived?: boolean | undefined;
};

export type SlackDirectoryPage = {
  readonly channels: readonly ProviderSlackChannel[];
  readonly nextCursor: string | null;
};

export type SlackBotIdentity = {
  readonly teamId: string;
  readonly apiAppId: string;
  readonly botUserId: string;
};

export type SlackDirectoryProviderService = {
  readonly authTest: (input: {
    readonly connectionKey: string;
    readonly nangoConnectionId?: string | null | undefined;
  }) => Promise<SlackBotIdentity>;
  readonly listChannels: (input: {
    readonly connectionKey: string;
    readonly nangoConnectionId?: string | null | undefined;
    readonly cursor: string | null;
    readonly limit: number;
  }) => Promise<SlackDirectoryPage>;
};

type PlannedUpsert = Omit<
  SourceChannelRowValue,
  "firstDiscoveredAt" | "updatedAt" | "lastSeenAt"
> & {
  readonly rowId?: GenericId<"sourceChannels">;
  readonly firstDiscoveredAt: number;
  readonly updatedAt: number;
  readonly lastSeenAt: number;
};

const normalizeChannelName = (name: string) => name.trim().toLowerCase();
const channelKeyFor = (connectionKey: string, externalChannelId: string) =>
  `${connectionKey}:${externalChannelId}`;

const promoteReauthorizedChannelRows = (input: {
  readonly existingChannels: readonly SourceChannelRowValue[];
  readonly currentGeneration: number;
}) =>
  input.existingChannels
    .filter((row) => row.connectionGeneration < input.currentGeneration)
    .map((row) => ({
      row: {
        ...row,
        connectionGeneration: input.currentGeneration,
      },
      patch: { connectionGeneration: input.currentGeneration },
    }));

const membershipStatusFor = (input: {
  readonly channel: ProviderSlackChannel;
  readonly existing?: SourceChannelRowValue | undefined;
}): SourceChannelRowValue["membershipStatus"] => {
  if (input.channel.is_archived === true) return "archived";
  if (!input.channel.is_member) {
    return input.existing?.isMember === true
      ? "access_lost"
      : "discovered_not_joined";
  }
  return input.existing?.membershipStatus === "joined_active"
    ? "joined_active"
    : "joined_needs_policy";
};

const validateReconcileConnection = (input: {
  readonly connectionKey: string;
  readonly expectedGeneration: number;
  readonly connection: SlackDirectoryConnection | null;
}): Either.Either<
  SlackDirectoryConnection,
  ConnectionNotFound | ConnectionGenerationMismatch | BotIdentityMismatch
> => {
  const connection = input.connection;
  if (connection === null || connection.status !== "active") {
    return Either.left(
      new ConnectionNotFound({ connectionKey: input.connectionKey }),
    );
  }
  if (connection.connectionGeneration !== input.expectedGeneration) {
    return Either.left(
      new ConnectionGenerationMismatch({
        connectionKey: input.connectionKey,
        expectedGeneration: input.expectedGeneration,
        actualGeneration: connection.connectionGeneration,
      }),
    );
  }
  if (!connection.teamId || !connection.apiAppId || !connection.botUserId) {
    return Either.left(
      new BotIdentityMismatch({ connectionKey: input.connectionKey }),
    );
  }
  return Either.right(connection);
};

const validateActivationConnection = (input: {
  readonly connectionKey: string;
  readonly expectedGeneration: number;
  readonly connection: SlackDirectoryConnection | null;
}): Either.Either<
  SlackDirectoryConnection,
  ConnectionNotFound | ConnectionGenerationMismatch
> => {
  const connection = input.connection;
  if (
    connection === null ||
    !["verifying", "reauthorizing", "active"].includes(connection.status)
  ) {
    return Either.left(
      new ConnectionNotFound({ connectionKey: input.connectionKey }),
    );
  }
  if (connection.connectionGeneration !== input.expectedGeneration) {
    return Either.left(
      new ConnectionGenerationMismatch({
        connectionKey: input.connectionKey,
        expectedGeneration: input.expectedGeneration,
        actualGeneration: connection.connectionGeneration,
      }),
    );
  }
  return Either.right(connection);
};

const directoryProviderError = (error: unknown) =>
  error instanceof ProviderRateLimited || error instanceof BotIdentityMismatch
    ? error
    : new ProviderUnavailable();

const verifyBotIdentity = (input: {
  readonly connectionKey: string;
  readonly connection: SlackDirectoryConnection;
  readonly providerIdentity: SlackBotIdentity;
}): Either.Either<void, BotIdentityMismatch> => {
  if (
    input.providerIdentity.teamId !== input.connection.teamId ||
    input.providerIdentity.apiAppId !== input.connection.apiAppId ||
    input.providerIdentity.botUserId !== input.connection.botUserId
  ) {
    return Either.left(
      new BotIdentityMismatch({ connectionKey: input.connectionKey }),
    );
  }
  return Either.right(undefined);
};

const hasDuplicateActiveBinding = (input: {
  readonly connectionKey: string;
  readonly providerIdentity: SlackBotIdentity;
  readonly activeConnections: readonly SlackDirectoryConnection[];
}) =>
  input.activeConnections.some(
    (connection) =>
      connection.connectionKey !== input.connectionKey &&
      connection.status === "active" &&
      connection.teamId === input.providerIdentity.teamId &&
      connection.apiAppId === input.providerIdentity.apiAppId &&
      connection.botUserId === input.providerIdentity.botUserId,
  );

export const activateSlackConnectionPlan = (input: {
  readonly connectionKey: string;
  readonly expectedGeneration: number;
  readonly connection: SlackDirectoryConnection | null;
  readonly providerIdentity: SlackBotIdentity;
  readonly activeConnections?: readonly SlackDirectoryConnection[];
  readonly now: number;
}): Either.Either<
  {
    readonly connection: SlackDirectoryConnection;
    readonly patch: Record<string, unknown>;
  },
  ConnectionNotFound | ConnectionGenerationMismatch | BotIdentityMismatch
> => {
  const validated = validateActivationConnection(input);
  if (Either.isLeft(validated)) return Either.left(validated.left);
  const connection = validated.right;
  if (
    hasDuplicateActiveBinding({
      connectionKey: input.connectionKey,
      providerIdentity: input.providerIdentity,
      activeConnections: input.activeConnections ?? [],
    })
  ) {
    return Either.left(
      new BotIdentityMismatch({ connectionKey: input.connectionKey }),
    );
  }
  if (connection.status === "active") {
    const verified = verifyBotIdentity({
      connectionKey: input.connectionKey,
      connection,
      providerIdentity: input.providerIdentity,
    });
    if (Either.isLeft(verified)) return Either.left(verified.left);
    return Either.right({ connection, patch: { updatedAt: input.now } });
  }
  if (
    connection.status === "reauthorizing" &&
    connection.teamId !== input.providerIdentity.teamId
  ) {
    return Either.left(
      new BotIdentityMismatch({ connectionKey: input.connectionKey }),
    );
  }
  if (
    connection.status === "reauthorizing" &&
    connection.apiAppId !== input.providerIdentity.apiAppId
  ) {
    return Either.left(
      new BotIdentityMismatch({ connectionKey: input.connectionKey }),
    );
  }
  if (
    connection.status === "reauthorizing" &&
    connection.botUserId !== input.providerIdentity.botUserId
  ) {
    return Either.left(
      new BotIdentityMismatch({ connectionKey: input.connectionKey }),
    );
  }
  const nextGeneration =
    connection.status === "reauthorizing"
      ? connection.connectionGeneration + 1
      : connection.connectionGeneration;
  const patch = {
    status: "active" as const,
    connectionGeneration: nextGeneration,
    teamId: input.providerIdentity.teamId,
    apiAppId: input.providerIdentity.apiAppId,
    botUserId: input.providerIdentity.botUserId,
    errorReason: null,
    updatedAt: input.now,
  };
  return Either.right({
    patch,
    connection: {
      ...connection,
      ...patch,
    },
  });
};

export const revokeSlackConnectionPlan = (input: {
  readonly connectionKey: string;
  readonly connection: SlackDirectoryConnection | null;
  readonly reason: "team_or_app_or_bot_changed" | "disconnect_or_uninstall";
  readonly now: number;
}): Either.Either<
  {
    readonly connectionPatch: Record<string, unknown>;
    readonly syncPatch: Record<string, unknown>;
    readonly audit: {
      readonly connectionKey: string;
      readonly connectionGeneration: number;
      readonly reason: string;
      readonly recordedAt: number;
    };
  },
  ConnectionNotFound
> => {
  const connection = input.connection;
  if (connection === null || connection.status === "revoked") {
    return Either.left(
      new ConnectionNotFound({ connectionKey: input.connectionKey }),
    );
  }
  return Either.right({
    connectionPatch: {
      status: "revoked" as const,
      errorReason: `replacement:${input.reason}`,
      updatedAt: input.now,
    },
    syncPatch: {
      status: "access_lost" as const,
      leaseId: null,
      leaseExpiresAt: null,
      updatedAt: input.now,
      replacementAudit: {
        connectionKey: input.connectionKey,
        connectionGeneration: connection.connectionGeneration,
        reason: input.reason,
        recordedAt: input.now,
      },
    },
    audit: {
      connectionKey: input.connectionKey,
      connectionGeneration: connection.connectionGeneration,
      reason: input.reason,
      recordedAt: input.now,
    },
  });
};

export const reconcileSlackChannelDirectoryPlan = (input: {
  readonly connectionKey: string;
  readonly expectedGeneration: number;
  readonly connection: SlackDirectoryConnection | null;
  readonly existingChannels: readonly SourceChannelRowValue[];
  readonly now: number;
  readonly cursor: string | null;
  readonly limit: number;
  readonly providerChannels?: readonly ProviderSlackChannel[];
  readonly providerNextCursor?: string | null;
}): Either.Either<
  {
    readonly upserts: readonly PlannedUpsert[];
    readonly accessGained: number;
    readonly accessLost: number;
    readonly nextCursor: string | null;
    readonly providerCalls: readonly string[];
  },
  | ConnectionNotFound
  | ConnectionGenerationMismatch
  | BotIdentityMismatch
  | ProviderRateLimited
  | ProviderUnavailable
> => {
  const validated = validateReconcileConnection(input);
  if (Either.isLeft(validated)) return Either.left(validated.left);
  const connection = validated.right;
  const start = input.cursor === null ? 0 : Number.parseInt(input.cursor, 10);
  if (!Number.isFinite(start) || start < 0 || input.limit < 1) {
    return Either.left(new ProviderUnavailable());
  }
  const providerChannels = input.providerChannels;
  if (providerChannels === undefined) {
    return Either.left(new ProviderUnavailable());
  }
  const page =
    input.providerNextCursor === undefined
      ? providerChannels.slice(start, start + input.limit)
      : providerChannels;
  const existingByExternalId = new Map(
    input.existingChannels
      .filter((row) => row.connectionKey === connection.connectionKey)
      .map((row) => [row.externalChannelId, row]),
  );
  let accessGained = 0;
  let accessLost = 0;
  const upserts = page.map((channel): PlannedUpsert => {
    const existing = existingByExternalId.get(channel.id);
    const membershipStatus = membershipStatusFor({ channel, existing });
    if (
      existing?.isMember !== true &&
      channel.is_member &&
      !channel.is_archived
    )
      accessGained += 1;
    if (
      existing?.isMember === true &&
      (!channel.is_member || channel.is_archived)
    )
      accessLost += 1;
    const rowId = (
      existing as { readonly _id?: GenericId<"sourceChannels"> } | undefined
    )?._id;
    return {
      ...(rowId ? { rowId } : {}),
      organizationKey: connection.organizationKey,
      connectionKey: connection.connectionKey,
      connectionGeneration: connection.connectionGeneration,
      channelKey:
        existing?.channelKey ??
        channelKeyFor(connection.connectionKey, channel.id),
      externalChannelId: channel.id,
      name: channel.name,
      normalizedName: normalizeChannelName(channel.name),
      isMember: channel.is_member,
      isShared: channel.is_shared === true,
      isExtShared: channel.is_ext_shared === true,
      isArchived: channel.is_archived === true,
      membershipStatus,
      accessGeneration:
        existing === undefined
          ? channel.is_member
            ? 1
            : 0
          : existing.isMember === false &&
              channel.is_member &&
              !channel.is_archived
            ? existing.accessGeneration + 1
            : existing.accessGeneration,
      firstDiscoveredAt: existing?.firstDiscoveredAt ?? input.now,
      lastSeenAt: input.now,
      updatedAt: input.now,
    };
  });
  const next = start + page.length;
  return Either.right({
    upserts,
    accessGained,
    accessLost,
    nextCursor:
      input.providerNextCursor === undefined
        ? next < providerChannels.length
          ? String(next)
          : null
        : input.providerNextCursor,
    providerCalls: ["auth.test", "conversations.list"],
  });
};

type RawIndexBuilder = {
  readonly eq: (field: string, value: unknown) => RawIndexBuilder;
};
type RawQuery = {
  readonly index: (
    name: string,
    range: (builder: RawIndexBuilder) => RawIndexBuilder,
  ) => RawQuery;
  readonly first: () => Effect.Effect<Option.Option<unknown>, unknown>;
  readonly take: (count: number) => Effect.Effect<readonly unknown[], unknown>;
  readonly collect: () => Effect.Effect<readonly unknown[], unknown>;
};
type RawWriterTable = {
  readonly insert: (
    row: Record<string, unknown>,
  ) => Effect.Effect<unknown, unknown>;
  readonly patch: (
    id: GenericId<string>,
    patch: Record<string, unknown>,
  ) => Effect.Effect<unknown, unknown>;
};
type SlackDirectoryActionConnection = Omit<SlackDirectoryConnection, "_id">;

const directoryRefs = {
  readConnection: Ref.make(
    "integrations/slackDirectory",
    readReconcileConnection,
  ),
  commitIdentity: Ref.make(
    "integrations/slackDirectory",
    commitReconcileIdentity,
  ),
  commitInitialFailure: Ref.make(
    "integrations/slackDirectory",
    commitInitialReconcileFailure,
  ),
  commitChannels: Ref.make(
    "integrations/slackDirectory",
    commitReconcileChannels,
  ),
};

type RawReader = { readonly table: (name: string) => RawQuery };
type RawWriter = { readonly table: (name: string) => RawWriterTable };
const rawReader = (reader: unknown): RawReader => reader as RawReader;
const rawWriter = (writer: unknown): RawWriter => writer as RawWriter;

const loadSlackDirectoryConnection = (input: {
  readonly connectionKey: string;
  readonly expectedGeneration: number;
}) =>
  Effect.gen(function* () {
    const reader = rawReader(yield* DatabaseReader);
    const connection = (yield* reader
      .table("providerConnections")
      .index("by_connection_key", (q) =>
        q.eq("connectionKey", input.connectionKey),
      )
      .first()
      .pipe(
        Effect.map(Option.getOrNull),
        Effect.orDie,
      )) as SlackDirectoryConnection | null;
    const activationCandidate = validateActivationConnection({
      ...input,
      connection,
    });
    if (Either.isLeft(activationCandidate)) {
      return yield* Effect.fail(activationCandidate.left);
    }
    return activationCandidate.right;
  });

const activeSlackConnectionsForDuplicateCheck = () =>
  Effect.gen(function* () {
    const reader = rawReader(yield* DatabaseReader);
    const connections = (yield* reader
      .table("providerConnections")
      .index("by_connection_key", (q) => q)
      .collect()
      .pipe(Effect.orDie)) as readonly (SlackDirectoryConnection & {
      readonly provider?: string;
      readonly providerConfigKey?: string;
    })[];
    return connections.filter(
      (connection) =>
        connection.provider === "nango" &&
        connection.providerConfigKey === "slack" &&
        connection.status === "active",
    );
  });

const applyReplacementRevocation = (input: {
  readonly connection: SlackDirectoryConnection;
  readonly now: number;
}) =>
  Effect.gen(function* () {
    const reader = rawReader(yield* DatabaseReader);
    const writer = rawWriter(yield* DatabaseWriter);
    const revoked = revokeSlackConnectionPlan({
      connectionKey: input.connection.connectionKey,
      connection: input.connection,
      reason: "team_or_app_or_bot_changed",
      now: input.now,
    });
    if (Either.isLeft(revoked)) return yield* Effect.fail(revoked.left);
    if (input.connection._id) {
      yield* writer
        .table("providerConnections")
        .patch(
          input.connection._id as GenericId<"providerConnections">,
          revoked.right.connectionPatch,
        )
        .pipe(Effect.orDie);
    }
    const sourceRows = (yield* reader
      .table("sourceChannels")
      .index("by_connection_generation", (q) =>
        q
          .eq("connectionKey", input.connection.connectionKey)
          .eq("connectionGeneration", input.connection.connectionGeneration),
      )
      .collect()
      .pipe(Effect.orDie)) as readonly (SourceChannelRowValue & {
      readonly _id?: GenericId<"sourceChannels">;
    })[];
    for (const channel of sourceRows) {
      if (!channel._id) continue;
      yield* writer
        .table("sourceChannels")
        .patch(channel._id, {
          isMember: false,
          membershipStatus: "access_lost" as const,
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);
    }
    const lanes = ["live", "recent", "deep", "reconciliation"] as const;
    let patchedSyncRows = 0;
    for (const lane of lanes) {
      const syncRows = (yield* reader
        .table("channelSyncStates")
        .index("by_access_state", (q) =>
          q
            .eq("connectionKey", input.connection.connectionKey)
            .eq("lane", lane),
        )
        .collect()
        .pipe(Effect.orDie)) as readonly {
        readonly _id?: GenericId<"channelSyncStates">;
      }[];
      for (const sync of syncRows) {
        if (!sync._id) continue;
        patchedSyncRows += 1;
        yield* writer
          .table("channelSyncStates")
          .patch(sync._id, revoked.right.syncPatch)
          .pipe(Effect.orDie);
      }
    }
    if (patchedSyncRows === 0) {
      yield* writer
        .table("channelSyncStates")
        .insert({
          organizationKey: input.connection.organizationKey,
          connectionKey: input.connection.connectionKey,
          connectionGeneration: input.connection.connectionGeneration,
          channelKey: `${input.connection.connectionKey}:__replacement_audit__`,
          lane: "reconciliation" as const,
          status: "access_lost" as const,
          cursor: null,
          leaseId: null,
          leaseExpiresAt: null,
          lastProgressAt: null,
          replacementAudit: revoked.right.audit,
          createdAt: input.now,
          updatedAt: input.now,
        })
        .pipe(Effect.orDie);
    }
  });

const readReconcileConnectionImpl = FunctionImpl.make(
  slackDirectoryDatabaseSchema,
  slackDirectory,
  "readReconcileConnection",
  (input) =>
    Effect.gen(function* () {
      const connection = yield* loadSlackDirectoryConnection(input);
      return {
        organizationKey: connection.organizationKey,
        connectionKey: connection.connectionKey,
        connectionGeneration: connection.connectionGeneration,
        status: connection.status,
        teamId: connection.teamId ?? null,
        apiAppId: connection.apiAppId ?? null,
        botUserId: connection.botUserId ?? null,
        nangoConnectionId: connection.nangoConnectionId ?? null,
      };
    }),
);

const commitReconcileIdentityImpl = FunctionImpl.make(
  slackDirectoryDatabaseSchema,
  slackDirectory,
  "commitReconcileIdentity",
  (input) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const writer = rawWriter(yield* DatabaseWriter);
      const connection = yield* loadSlackDirectoryConnection(input);
      const activeConnections =
        yield* activeSlackConnectionsForDuplicateCheck();
      const activated = activateSlackConnectionPlan({
        ...input,
        connection,
        activeConnections,
        now,
      });
      if (Either.isLeft(activated)) {
        if (
          connection.status === "active" ||
          connection.status === "reauthorizing"
        ) {
          yield* applyReplacementRevocation({ connection, now });
          return { kind: "bot_identity_mismatch" as const };
        }
        return yield* Effect.fail(activated.left);
      }
      if (connection._id) {
        yield* writer
          .table("providerConnections")
          .patch(
            connection._id as GenericId<"providerConnections">,
            activated.right.patch,
          )
          .pipe(Effect.orDie);
      }
      return {
        kind: "ok" as const,
        connectionGeneration: activated.right.connection.connectionGeneration,
      };
    }),
);

const commitInitialReconcileFailureImpl = FunctionImpl.make(
  slackDirectoryDatabaseSchema,
  slackDirectory,
  "commitInitialReconcileFailure",
  (input) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const writer = rawWriter(yield* DatabaseWriter);
      const connection = yield* loadSlackDirectoryConnection(input);
      if (connection._id) {
        yield* writer
          .table("providerConnections")
          .patch(connection._id as GenericId<"providerConnections">, {
            status: "error" as const,
            errorReason: "initial_reconciliation_failed",
            updatedAt: now,
          })
          .pipe(Effect.orDie);
      }
      return { upserted: 0, accessGained: 0, accessLost: 0, nextCursor: null };
    }),
);

const commitReconcileChannelsImpl = FunctionImpl.make(
  slackDirectoryDatabaseSchema,
  slackDirectory,
  "commitReconcileChannels",
  (input) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const reader = rawReader(yield* DatabaseReader);
      const writer = rawWriter(yield* DatabaseWriter);
      const connection = yield* loadSlackDirectoryConnection(input);
      const activeConnections =
        yield* activeSlackConnectionsForDuplicateCheck();
      const activated = activateSlackConnectionPlan({
        connectionKey: input.connectionKey,
        expectedGeneration: input.expectedGeneration,
        connection,
        providerIdentity: input.providerIdentity,
        activeConnections,
        now,
      });
      if (Either.isLeft(activated)) {
        if (
          connection.status === "active" ||
          connection.status === "reauthorizing"
        ) {
          yield* applyReplacementRevocation({ connection, now });
          return { kind: "bot_identity_mismatch" as const };
        }
        return yield* Effect.fail(activated.left);
      }
      if (connection._id) {
        yield* writer
          .table("providerConnections")
          .patch(
            connection._id as GenericId<"providerConnections">,
            activated.right.patch,
          )
          .pipe(Effect.orDie);
      }
      const existingChannels = (yield* reader
        .table("sourceChannels")
        .index("by_connection_generation", (q) =>
          q.eq("connectionKey", activated.right.connection.connectionKey),
        )
        .collect()
        .pipe(Effect.orDie)) as readonly SourceChannelRowValue[];
      const promotedChannels = promoteReauthorizedChannelRows({
        existingChannels,
        currentGeneration: activated.right.connection.connectionGeneration,
      });
      for (const promoted of promotedChannels) {
        const rowId = (
          promoted.row as { readonly _id?: GenericId<"sourceChannels"> }
        )._id;
        if (rowId) {
          yield* writer
            .table("sourceChannels")
            .patch(rowId, promoted.patch)
            .pipe(Effect.orDie);
        }
      }
      const planned = reconcileSlackChannelDirectoryPlan({
        connectionKey: input.connectionKey,
        expectedGeneration: activated.right.connection.connectionGeneration,
        connection: activated.right.connection,
        existingChannels: existingChannels.map(
          (row) =>
            promotedChannels.find(
              (promoted) =>
                promoted.row.externalChannelId === row.externalChannelId,
            )?.row ?? row,
        ),
        now,
        cursor: input.cursor,
        limit: input.limit,
        providerChannels: input.providerChannels,
        providerNextCursor: input.providerNextCursor,
      });
      if (Either.isLeft(planned)) return yield* Effect.fail(planned.left);
      for (const promoted of promotedChannels) {
        const syncRows = (yield* reader
          .table("channelSyncStates")
          .index("by_channel", (q) =>
            q.eq("channelKey", promoted.row.channelKey),
          )
          .take(100)
          .pipe(Effect.orDie)) as readonly {
          readonly _id?: GenericId<"channelSyncStates">;
        }[];
        for (const sync of syncRows) {
          if (!sync._id) continue;
          yield* writer
            .table("channelSyncStates")
            .patch(sync._id, {
              connectionGeneration: promoted.row.connectionGeneration,
              updatedAt: now,
            } satisfies Partial<ChannelSyncStateRowValue>)
            .pipe(Effect.orDie);
        }
      }
      for (const upsert of planned.right.upserts) {
        const { rowId, ...row } = upsert;
        if (rowId)
          yield* writer
            .table("sourceChannels")
            .patch(rowId, row)
            .pipe(Effect.orDie);
        else
          yield* writer.table("sourceChannels").insert(row).pipe(Effect.orDie);
        const sync = yield* reader
          .table("channelSyncStates")
          .index("by_channel", (q) =>
            q.eq("channelKey", row.channelKey).eq("lane", "live"),
          )
          .first()
          .pipe(Effect.map(Option.getOrNull), Effect.orDie);
        const syncRow = {
          organizationKey: row.organizationKey,
          connectionKey: row.connectionKey,
          connectionGeneration: row.connectionGeneration,
          channelKey: row.channelKey,
          lane: "live" as const,
          updatedAt: now,
        };
        const syncId = (
          sync as { readonly _id?: GenericId<"channelSyncStates"> } | null
        )?._id;
        if (syncId)
          yield* writer
            .table("channelSyncStates")
            .patch(syncId, syncRow)
            .pipe(Effect.orDie);
        else
          yield* writer
            .table("channelSyncStates")
            .insert({
              ...syncRow,
              status: "idle" as const,
              cursor: null,
              leaseId: null,
              leaseExpiresAt: null,
              lastProgressAt: null,
              createdAt: now,
            })
            .pipe(Effect.orDie);
      }
      return {
        kind: "ok" as const,
        result: {
          upserted: planned.right.upserts.length,
          accessGained: planned.right.accessGained,
          accessLost: planned.right.accessLost,
          nextCursor: planned.right.nextCursor,
        },
      };
    }),
);

type QueryBridge = <Query extends Ref.AnyQuery>(
  query: Query,
  ...args: Ref.OptionalArgs<Query>
) => Effect.Effect<Ref.Returns<Query>, Ref.Error<Query>>;
type MutationBridge = <Mutation extends Ref.AnyMutation>(
  mutation: Mutation,
  ...args: Ref.OptionalArgs<Mutation>
) => Effect.Effect<Ref.Returns<Mutation>, Ref.Error<Mutation>>;

const makeReconcileChannels = (
  slackDirectoryProvider: SlackDirectoryProviderService,
) =>
  FunctionImpl.make(
    databaseSchema,
    slackDirectory,
    "reconcileChannels",
    (input) =>
      Effect.gen(function* () {
        const query = yield* QueryRunner;
        const mutation = yield* MutationRunner;
        const connection = (yield* (query as QueryBridge)(
          directoryRefs.readConnection,
          {
            connectionKey: input.connectionKey,
            expectedGeneration: input.expectedGeneration,
          },
        )) as SlackDirectoryActionConnection;
        const providerIdentity = yield* Effect.tryPromise({
          try: () =>
            slackDirectoryProvider.authTest({
              connectionKey: input.connectionKey,
              nangoConnectionId: connection.nangoConnectionId,
            }),
          catch: directoryProviderError,
        });
        const identityCommit = yield* (mutation as MutationBridge)(
          directoryRefs.commitIdentity,
          {
            connectionKey: input.connectionKey,
            expectedGeneration: input.expectedGeneration,
            providerIdentity,
          },
        );
        if (identityCommit.kind === "bot_identity_mismatch") {
          return yield* Effect.fail(
            new BotIdentityMismatch({ connectionKey: input.connectionKey }),
          );
        }
        const providerPageResult = yield* Effect.either(
          Effect.tryPromise({
            try: () =>
              slackDirectoryProvider.listChannels({
                connectionKey: input.connectionKey,
                nangoConnectionId: connection.nangoConnectionId,
                cursor: input.cursor,
                limit: input.limit,
              }),
            catch: directoryProviderError,
          }),
        );
        if (Either.isLeft(providerPageResult)) {
          if (connection.status === "verifying") {
            return yield* (mutation as MutationBridge)(
              directoryRefs.commitInitialFailure,
              {
                connectionKey: input.connectionKey,
                expectedGeneration: identityCommit.connectionGeneration,
              },
            );
          }
          return yield* Effect.fail(providerPageResult.left);
        }
        const channelCommit = yield* (mutation as MutationBridge)(
          directoryRefs.commitChannels,
          {
            connectionKey: input.connectionKey,
            expectedGeneration: identityCommit.connectionGeneration,
            providerIdentity,
            cursor: input.cursor,
            limit: input.limit,
            providerChannels: providerPageResult.right.channels,
            providerNextCursor: providerPageResult.right.nextCursor,
          },
        );
        if (channelCommit.kind === "bot_identity_mismatch") {
          return yield* Effect.fail(
            new BotIdentityMismatch({ connectionKey: input.connectionKey }),
          );
        }
        return channelCommit.result;
      }),
  );

const unavailableSlackDirectoryProvider: SlackDirectoryProviderService = {
  authTest: () => Promise.reject(new ProviderUnavailable()),
  listChannels: () => Promise.reject(new ProviderUnavailable()),
};

export const makeSlackDirectoryImpl = (
  slackDirectoryProvider: SlackDirectoryProviderService = unavailableSlackDirectoryProvider,
) =>
  GroupImpl.make(databaseSchema, slackDirectory).pipe(
    Layer.provide(makeReconcileChannels(slackDirectoryProvider)),
    Layer.provide(readReconcileConnectionImpl),
    Layer.provide(commitReconcileIdentityImpl),
    Layer.provide(commitInitialReconcileFailureImpl),
    Layer.provide(commitReconcileChannelsImpl),
    GroupImpl.finalize,
  );

export default makeSlackDirectoryImpl();
