import { Ref } from "@confect/core";
import {
  DatabaseSchema,
  RegisteredConvexFunction,
  RegisteredFunctions,
} from "@confect/server";
import { TestConfect } from "@confect/test";
import { defineSchema } from "convex/server";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import databaseSchema from "../confect/_generated/schema";
import { Id } from "../confect/_generated/id";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import {
  makeSlackDirectoryImpl,
  reconcileSlackChannelDirectoryPlan,
} from "../confect/integrations/slackDirectory.impl";
import slackDirectory, {
  ProviderRateLimited,
  reconcileChannels,
} from "../confect/integrations/slackDirectory.spec";
import channelSyncStatesSource from "../confect/tables/channelSyncStates";
import providerConnectionsSource from "../confect/tables/providerConnections";
import sourceChannelsSource, {
  SourceChannelRow,
} from "../confect/tables/sourceChannels";

const directoryRefs = {
  reconcile: Ref.make("integrations/slackDirectory", reconcileChannels),
};

const providerConnections = providerConnectionsSource("providerConnections");
const sourceChannels = sourceChannelsSource("sourceChannels");
const channelSyncStates = channelSyncStatesSource("channelSyncStates");
const transientDatabaseSchema = DatabaseSchema.make({
  ...databaseSchema.tables,
  providerConnections,
  sourceChannels,
  channelSyncStates,
});
const transientConvexSchema = defineSchema({
  ...Object.fromEntries(
    Object.entries(databaseSchema.tables).map(([name, table]) => [
      name,
      table.tableDefinition,
    ]),
  ),
  providerConnections: providerConnections.tableDefinition,
  sourceChannels: sourceChannels.tableDefinition,
  channelSyncStates: channelSyncStates.tableDefinition,
});
const slackDirectoryProvider = {
  listChannels: async ({
    cursor,
    limit,
  }: {
    cursor: string | null;
    limit: number;
  }) => {
    const channels = [
      { id: "C_general", name: "general", is_member: true },
      { id: "C_random", name: "random", is_member: false },
      {
        id: "C_shared",
        name: "shared-client",
        is_member: true,
        is_shared: true,
        is_ext_shared: true,
      },
    ];
    const start = cursor === null ? 0 : Number.parseInt(cursor, 10);
    return {
      channels: channels.slice(start, start + limit),
      nextCursor:
        start + limit < channels.length ? String(start + limit) : null,
    };
  },
};
const directoryRegisteredFunctions = RegisteredFunctions.buildForGroup<
  typeof slackDirectory
>(
  transientDatabaseSchema,
  makeSlackDirectoryImpl(slackDirectoryProvider),
  RegisteredConvexFunction.make,
);
const slackDirectoryTestLayer = TestConfect.layer(
  transientDatabaseSchema,
  transientConvexSchema,
  {
    ...import.meta.glob("../convex/**/!(*.*.*)*.*s"),
    "../convex/integrations/slackDirectory.ts": async () =>
      directoryRegisteredFunctions,
  },
);

const seedConnection = () =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    return yield* writer
      .table("providerConnections")
      .insert({
        provider: "nango" as const,
        providerConfigKey: "slack",
        organizationKey: "agency_acme",
        connectionKey: "slack_agency_acme",
        connectionGeneration: 2,
        status: "active" as const,
        connectSessionId: "maestro-session-directory",
        nangoConnectionId: "nango-conn-directory",
        nangoEndUserId: "nango-user-directory",
        nangoOrganizationId: "nango-org-directory",
        correlationTag: "slack-connect:maestro-session-directory",
        attemptId: "attempt_directory",
        attemptExpiresAt: 2_000,
        completedAt: 1_000,
        teamId: "T_acme",
        apiAppId: "A_acme",
        botUserId: "B_acme",
        createdAt: 1_000,
        updatedAt: 1_000,
      })
      .pipe(Effect.orDie);
  });

describe("Slack channel directory contract", () => {
  it("requires an explicit provider directory fixture", () => {
    const planned = reconcileSlackChannelDirectoryPlan({
      connectionKey: "slack_agency_acme",
      expectedGeneration: 2,
      connection: {
        connectionKey: "slack_agency_acme",
        organizationKey: "agency_acme",
        connectionGeneration: 2,
        status: "active",
        teamId: "T_acme",
        apiAppId: "A_acme",
        botUserId: "B_acme",
      },
      existingChannels: [],
      now: 2_000,
      cursor: null,
      limit: 2,
    });
    expect(Either.isLeft(planned)).toBe(true);
    if (Either.isLeft(planned)) {
      expect(planned.left).toMatchObject({ _tag: "ProviderUnavailable" });
    }
  });

  it("plans full pages without auto-join and preserves channel keys on rename", () => {
    const first = reconcileSlackChannelDirectoryPlan({
      connectionKey: "slack_agency_acme",
      expectedGeneration: 2,
      connection: {
        connectionKey: "slack_agency_acme",
        organizationKey: "agency_acme",
        connectionGeneration: 2,
        status: "active",
        teamId: "T_acme",
        apiAppId: "A_acme",
        botUserId: "B_acme",
      },
      existingChannels: [],
      now: 2_000,
      cursor: null,
      limit: 2,
      providerChannels: [
        { id: "C_general", name: "general", is_member: true },
        { id: "C_random", name: "random", is_member: false },
        { id: "C_shared", name: "shared-client", is_member: true },
      ],
    });
    expect(Either.isRight(first)).toBe(true);
    if (Either.isRight(first)) {
      expect(first.right.providerCalls).not.toContain("conversations.join");
      expect(first.right.nextCursor).toBe("2");
      expect(first.right.upserts).toHaveLength(2);
      expect(first.right.upserts[0]).toMatchObject({
        channelKey: "slack_agency_acme:C_general",
        membershipStatus: "joined_needs_policy",
        isMember: true,
        isShared: false,
      });
    }

    const renamed = reconcileSlackChannelDirectoryPlan({
      connectionKey: "slack_agency_acme",
      expectedGeneration: 2,
      connection: {
        connectionKey: "slack_agency_acme",
        organizationKey: "agency_acme",
        connectionGeneration: 2,
        status: "active",
        teamId: "T_acme",
        apiAppId: "A_acme",
        botUserId: "B_acme",
      },
      existingChannels: [
        SourceChannelRow.make({
          organizationKey: "agency_acme",
          connectionKey: "slack_agency_acme",
          connectionGeneration: 2,
          channelKey: "slack_agency_acme:C_general",
          externalChannelId: "C_general",
          name: "general",
          normalizedName: "general",
          isMember: true,
          isShared: false,
          isExtShared: false,
          isArchived: false,
          membershipStatus: "joined_needs_policy",
          accessGeneration: 1,
          firstDiscoveredAt: 1_000,
          lastSeenAt: 1_000,
          updatedAt: 1_000,
        }),
      ],
      now: 2_000,
      cursor: null,
      limit: 1,
      providerChannels: [
        {
          id: "C_general",
          name: "team-general",
          is_member: true,
          is_shared: true,
          is_ext_shared: true,
          is_archived: false,
        },
      ],
    });
    expect(Either.isRight(renamed)).toBe(true);
    if (Either.isRight(renamed)) {
      expect(renamed.right.upserts[0]).toMatchObject({
        channelKey: "slack_agency_acme:C_general",
        name: "team-general",
        isShared: true,
        isExtShared: true,
        accessGeneration: 1,
      });
    }
  });

  it("increments access generation only when channel access is regained", () => {
    const previous = SourceChannelRow.make({
      organizationKey: "agency_acme",
      connectionKey: "slack_agency_acme",
      connectionGeneration: 2,
      channelKey: "slack_agency_acme:C_general",
      externalChannelId: "C_general",
      name: "general",
      normalizedName: "general",
      isMember: false,
      isShared: false,
      isExtShared: false,
      isArchived: false,
      membershipStatus: "access_lost",
      accessGeneration: 1,
      firstDiscoveredAt: 1_000,
      lastSeenAt: 1_000,
      updatedAt: 1_000,
    });
    const regained = reconcileSlackChannelDirectoryPlan({
      connectionKey: "slack_agency_acme",
      expectedGeneration: 2,
      connection: {
        connectionKey: "slack_agency_acme",
        organizationKey: "agency_acme",
        connectionGeneration: 2,
        status: "active",
        teamId: "T_acme",
        apiAppId: "A_acme",
        botUserId: "B_acme",
      },
      existingChannels: [previous],
      now: 2_000,
      cursor: null,
      limit: 1,
      providerChannels: [{ id: "C_general", name: "general", is_member: true }],
    });
    expect(Either.isRight(regained)).toBe(true);
    if (Either.isRight(regained)) {
      expect(regained.right.upserts[0]?.accessGeneration).toBe(2);
      expect(regained.right.accessGained).toBe(1);
    }
  });

  it("does not call the provider for stale generations", async () => {
    let providerCalls = 0;
    const guardedFunctions = RegisteredFunctions.buildForGroup<
      typeof slackDirectory
    >(
      transientDatabaseSchema,
      makeSlackDirectoryImpl({
        listChannels: async () => {
          providerCalls += 1;
          return { channels: [], nextCursor: null };
        },
      }),
      RegisteredConvexFunction.make,
    );
    const guardedLayer = TestConfect.layer(
      transientDatabaseSchema,
      transientConvexSchema,
      {
        ...import.meta.glob("../convex/**/!(*.*.*)*.*s"),
        "../convex/integrations/slackDirectory.ts": async () =>
          guardedFunctions,
      },
    );

    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      yield* confect.run(seedConnection(), Id("providerConnections"));
      const stale = yield* Effect.either(
        confect.mutation(directoryRefs.reconcile, {
          connectionKey: "slack_agency_acme",
          expectedGeneration: 1,
          cursor: null,
          limit: 1,
        }),
      );
      expect(Either.isLeft(stale)).toBe(true);
      if (Either.isLeft(stale)) {
        expect(stale.left).toMatchObject({
          _tag: "ConnectionGenerationMismatch",
        });
      }
    });

    await Effect.runPromise(program.pipe(Effect.provide(guardedLayer())));
    expect(providerCalls).toBe(0);
  });

  it("surfaces provider rate limits as a typed directory error", async () => {
    const rateLimitedFunctions = RegisteredFunctions.buildForGroup<
      typeof slackDirectory
    >(
      transientDatabaseSchema,
      makeSlackDirectoryImpl({
        listChannels: async () => {
          throw new ProviderRateLimited({ retryAfterMs: 1_500 });
        },
      }),
      RegisteredConvexFunction.make,
    );
    const rateLimitedLayer = TestConfect.layer(
      transientDatabaseSchema,
      transientConvexSchema,
      {
        ...import.meta.glob("../convex/**/!(*.*.*)*.*s"),
        "../convex/integrations/slackDirectory.ts": async () =>
          rateLimitedFunctions,
      },
    );

    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      yield* confect.run(seedConnection(), Id("providerConnections"));
      const limited = yield* Effect.either(
        confect.mutation(directoryRefs.reconcile, {
          connectionKey: "slack_agency_acme",
          expectedGeneration: 2,
          cursor: null,
          limit: 1,
        }),
      );
      expect(Either.isLeft(limited)).toBe(true);
      if (Either.isLeft(limited)) {
        expect(limited.left).toMatchObject({
          _tag: "ProviderRateLimited",
          retryAfterMs: 1_500,
        });
      }
    });

    await Effect.runPromise(program.pipe(Effect.provide(rateLimitedLayer())));
  });

  it("persists bot identity, channel rows, independent cursors, and generation fences", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      yield* confect.run(seedConnection(), Id("providerConnections"));

      const first = yield* confect.mutation(directoryRefs.reconcile, {
        connectionKey: "slack_agency_acme",
        expectedGeneration: 2,
        cursor: null,
        limit: 2,
      });
      expect(first).toEqual({
        upserted: 2,
        accessGained: 1,
        accessLost: 0,
        nextCursor: "2",
      });
      yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const writer = yield* DatabaseWriter;
          const rawReader = reader as unknown as {
            table: (name: string) => {
              index: (
                name: string,
                range: (q: {
                  eq: (field: string, value: unknown) => unknown;
                }) => unknown,
              ) => { first: () => Effect.Effect<unknown, unknown> };
            };
          };
          const rawWriter = writer as unknown as {
            table: (name: string) => {
              patch: (
                id: string,
                patch: unknown,
              ) => Effect.Effect<unknown, unknown>;
            };
          };
          const cursorRow = yield* rawReader
            .table("channelSyncStates")
            .index("by_channel_lane", (q) =>
              q.eq("channelKey", "slack_agency_acme:C_general"),
            )
            .first()
            .pipe(Effect.orDie);
          const sync =
            "value" in (cursorRow as object)
              ? (cursorRow as { value: { _id: string } }).value
              : (cursorRow as { _id: string });
          yield* rawWriter
            .table("channelSyncStates")
            .patch(sync._id, {
              status: "running",
              cursor: "ts-123",
              leaseId: "lease-1",
              leaseExpiresAt: 2_500,
              lastProgressAt: 2_100,
            })
            .pipe(Effect.orDie);
        }),
        Schema.Any,
      );
      const replay = yield* confect.mutation(directoryRefs.reconcile, {
        connectionKey: "slack_agency_acme",
        expectedGeneration: 2,
        cursor: null,
        limit: 1,
      });
      expect(replay).toMatchObject({ upserted: 1, nextCursor: "1" });
      const second = yield* confect.mutation(directoryRefs.reconcile, {
        connectionKey: "slack_agency_acme",
        expectedGeneration: 2,
        cursor: first.nextCursor,
        limit: 2,
      });
      expect(second).toMatchObject({ upserted: 1, nextCursor: null });

      const rows = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const raw = reader as unknown as {
            table: (name: string) => {
              index: (
                name: string,
                range: (q: {
                  eq: (field: string, value: unknown) => unknown;
                }) => unknown,
              ) => {
                take: (count: number) => Effect.Effect<unknown, unknown>;
                first: () => Effect.Effect<unknown, unknown>;
              };
            };
          };
          const channels = yield* raw
            .table("sourceChannels")
            .index("by_connection_generation", (q) =>
              q.eq("connectionKey", "slack_agency_acme"),
            )
            .take(10)
            .pipe(Effect.orDie);
          const cursorRow = yield* raw
            .table("channelSyncStates")
            .index("by_channel_lane", (q) =>
              q.eq("channelKey", "slack_agency_acme:C_general"),
            )
            .first()
            .pipe(Effect.orDie);
          const cursor =
            "value" in (cursorRow as object)
              ? (cursorRow as { value: unknown }).value
              : cursorRow;
          return { channels, cursor };
        }),
        Schema.Any,
      );
      expect(rows.channels).toHaveLength(3);
      expect(rows.channels).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            channelKey: "slack_agency_acme:C_general",
            membershipStatus: "joined_needs_policy",
            isMember: true,
          }),
          expect.objectContaining({
            channelKey: "slack_agency_acme:C_random",
            membershipStatus: "discovered_not_joined",
            isMember: false,
          }),
          expect.objectContaining({
            channelKey: "slack_agency_acme:C_shared",
            isShared: true,
            isExtShared: true,
          }),
        ]),
      );
      expect(rows.cursor).toMatchObject({
        lane: "live",
        cursor: "ts-123",
        status: "running",
        leaseId: "lease-1",
        lastProgressAt: 2_100,
      });

      const stale = yield* Effect.either(
        confect.mutation(directoryRefs.reconcile, {
          connectionKey: "slack_agency_acme",
          expectedGeneration: 1,
          cursor: null,
          limit: 1,
        }),
      );
      expect(Either.isLeft(stale)).toBe(true);
      if (Either.isLeft(stale)) {
        expect(stale.left).toMatchObject({
          _tag: "ConnectionGenerationMismatch",
        });
      }
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(slackDirectoryTestLayer())),
    );
  });
});
