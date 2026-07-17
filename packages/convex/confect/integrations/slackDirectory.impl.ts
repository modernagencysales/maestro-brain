import { FunctionImpl, GroupImpl } from "@confect/server";
import type { GenericId } from "convex/values";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";

import databaseSchema from "../_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../_generated/services";
import type { ProviderConnectionRow } from "./slackConnections.impl";
import slackDirectory, {
  BotIdentityMismatch,
  ConnectionGenerationMismatch,
  ConnectionNotFound,
  ProviderRateLimited,
  ProviderUnavailable,
} from "./slackDirectory.spec";
import type { SourceChannelRowValue } from "../tables/sourceChannels";

type ActiveSlackConnection = Pick<
  ProviderConnectionRow,
  | "organizationKey"
  | "connectionKey"
  | "connectionGeneration"
  | "status"
  | "teamId"
  | "apiAppId"
  | "botUserId"
  | "nangoConnectionId"
>;

export type ProviderSlackChannel = {
  readonly id: string;
  readonly name: string;
  readonly is_member: boolean;
  readonly is_shared?: boolean;
  readonly is_ext_shared?: boolean;
  readonly is_archived?: boolean;
};

export type SlackDirectoryPage = {
  readonly channels: readonly ProviderSlackChannel[];
  readonly nextCursor: string | null;
};

export type SlackDirectoryProviderService = {
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
  readonly connection: ActiveSlackConnection | null;
}): Either.Either<
  ActiveSlackConnection,
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

const directoryProviderError = (error: unknown) =>
  error instanceof ProviderRateLimited ? error : new ProviderUnavailable();

export const reconcileSlackChannelDirectoryPlan = (input: {
  readonly connectionKey: string;
  readonly expectedGeneration: number;
  readonly connection: ActiveSlackConnection | null;
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
    input.existingChannels.map((row) => [row.externalChannelId, row]),
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
type RawReader = { readonly table: (name: string) => RawQuery };
type RawWriter = { readonly table: (name: string) => RawWriterTable };
const rawReader = (reader: unknown): RawReader => reader as RawReader;
const rawWriter = (writer: unknown): RawWriter => writer as RawWriter;

const makeReconcileChannels = (
  slackDirectoryProvider: SlackDirectoryProviderService,
) =>
  FunctionImpl.make(
    databaseSchema,
    slackDirectory,
    "reconcileChannels",
    (input) =>
      Effect.gen(function* () {
        const reader = rawReader(yield* DatabaseReader);
        const writer = rawWriter(yield* DatabaseWriter);
        const connection = (yield* reader
          .table("providerConnections")
          .index("by_connection_key", (q) =>
            q.eq("connectionKey", input.connectionKey),
          )
          .first()
          .pipe(
            Effect.map(Option.getOrNull),
            Effect.orDie,
          )) as ActiveSlackConnection | null;
        const validated = validateReconcileConnection({
          connectionKey: input.connectionKey,
          expectedGeneration: input.expectedGeneration,
          connection,
        });
        if (Either.isLeft(validated)) return yield* Effect.fail(validated.left);
        const existingChannels = (yield* reader
          .table("sourceChannels")
          .index("by_connection_generation", (q) =>
            q
              .eq("connectionKey", input.connectionKey)
              .eq("connectionGeneration", input.expectedGeneration),
          )
          .take(1_000)
          .pipe(Effect.orDie)) as readonly SourceChannelRowValue[];
        const now = Date.now();
        const providerPage = yield* Effect.tryPromise({
          try: () =>
            slackDirectoryProvider.listChannels({
              connectionKey: input.connectionKey,
              nangoConnectionId: validated.right.nangoConnectionId,
              cursor: input.cursor,
              limit: input.limit,
            }),
          catch: directoryProviderError,
        });
        const planned = reconcileSlackChannelDirectoryPlan({
          ...input,
          connection,
          existingChannels,
          now,
          providerChannels: providerPage.channels,
          providerNextCursor: providerPage.nextCursor,
        });
        if (Either.isLeft(planned)) return yield* Effect.fail(planned.left);
        for (const upsert of planned.right.upserts) {
          const { rowId, ...row } = upsert;
          if (rowId)
            yield* writer
              .table("sourceChannels")
              .patch(rowId, row)
              .pipe(Effect.orDie);
          else
            yield* writer
              .table("sourceChannels")
              .insert(row)
              .pipe(Effect.orDie);
          const sync = yield* reader
            .table("channelSyncStates")
            .index("by_channel_lane", (q) =>
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
          upserted: planned.right.upserts.length,
          accessGained: planned.right.accessGained,
          accessLost: planned.right.accessLost,
          nextCursor: planned.right.nextCursor,
        };
      }),
  );

const unavailableSlackDirectoryProvider: SlackDirectoryProviderService = {
  listChannels: () => Promise.reject(new ProviderUnavailable()),
};

export const makeSlackDirectoryImpl = (
  slackDirectoryProvider: SlackDirectoryProviderService = unavailableSlackDirectoryProvider,
) =>
  GroupImpl.make(databaseSchema, slackDirectory).pipe(
    Layer.provide(makeReconcileChannels(slackDirectoryProvider)),
    GroupImpl.finalize,
  );

export default makeSlackDirectoryImpl();
