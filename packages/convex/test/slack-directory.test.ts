import { Ref } from "@confect/core";
import { RegisteredConvexFunction, RegisteredFunctions } from "@confect/server";
import { TestConfect } from "@confect/test";
import { defineSchema } from "convex/server";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Either from "effect/Either";
import * as Schema from "effect/Schema";
import * as TestClock from "effect/TestClock";
import * as TestContext from "effect/TestContext";
import { describe, expect, it } from "vitest";

import databaseSchema from "../confect/_generated/schema";
import { Id } from "../confect/_generated/id";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import {
  activateSlackConnectionPlan,
  makeSlackDirectoryImpl,
  reconcileSlackChannelDirectoryPlan,
  slackDirectoryDatabaseSchema,
  revokeSlackConnectionPlan,
} from "../confect/integrations/slackDirectory.impl";
import slackDirectory, {
  ProviderRateLimited,
  commitReconcileChannels,
  commitReconcileIdentity,
  reconcileChannels,
} from "../confect/integrations/slackDirectory.spec";
import channelSyncStatesSource from "../confect/tables/channelSyncStates";
import providerConnectionsSource from "../confect/tables/providerConnections";
import sourceChannelsSource, {
  SourceChannelRow,
} from "../confect/tables/sourceChannels";

const directoryRefs = {
  reconcile: Ref.make("integrations/slackDirectory", reconcileChannels),
  commitIdentity: Ref.make(
    "integrations/slackDirectory",
    commitReconcileIdentity,
  ),
  commitChannels: Ref.make(
    "integrations/slackDirectory",
    commitReconcileChannels,
  ),
};

const providerConnections = providerConnectionsSource("providerConnections");
const sourceChannels = sourceChannelsSource("sourceChannels");
const channelSyncStates = channelSyncStatesSource("channelSyncStates");
const transientDatabaseSchema = slackDirectoryDatabaseSchema;
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
  authTest: async () => ({
    teamId: "T_acme",
    apiAppId: "A_acme",
    botUserId: "B_acme",
  }),
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

const seedVerifyingConnection = () =>
  Effect.gen(function* () {
    const writer = yield* DatabaseWriter;
    return yield* writer
      .table("providerConnections")
      .insert({
        provider: "nango" as const,
        providerConfigKey: "slack",
        organizationKey: "agency_acme",
        connectionKey: "slack_agency_acme",
        connectionGeneration: 0,
        status: "verifying" as const,
        connectSessionId: "maestro-session-verifying",
        nangoConnectionId: "nango-conn-verifying",
        nangoEndUserId: "nango-user-verifying",
        nangoOrganizationId: "nango-org-verifying",
        correlationTag: "slack-connect:maestro-session-verifying",
        attemptId: "attempt_verifying",
        attemptExpiresAt: 2_000,
        completedAt: 1_000,
        teamId: null,
        apiAppId: null,
        botUserId: null,
        createdAt: 1_000,
        updatedAt: 1_000,
      })
      .pipe(Effect.orDie);
  });

const indexInventory = (table: { readonly tableDefinition: unknown }) => {
  const definition = table.tableDefinition as {
    readonly indexes: readonly {
      readonly indexDescriptor: string;
      readonly fields: readonly string[];
    }[];
  };
  return Object.fromEntries(
    definition.indexes.map((index) => [
      index.indexDescriptor,
      [...index.fields],
    ]),
  );
};

describe("Slack channel directory contract", () => {
  it("exposes the approved downstream Slack directory index inventory", () => {
    expect(indexInventory(sourceChannels)).toEqual({
      by_connection_external_channel: ["connectionKey", "externalChannelId"],
      by_channel_key: ["channelKey"],
      by_organization_membership_state: ["organizationKey", "membershipStatus"],
      by_connection_generation: ["connectionKey", "connectionGeneration"],
    });
    expect(indexInventory(channelSyncStates)).toEqual({
      by_channel: ["channelKey", "lane"],
      by_live_lag: ["organizationKey", "status", "lastProgressAt"],
      by_recent_next_retry: ["organizationKey", "status", "leaseExpiresAt"],
      by_deep_next_retry: ["organizationKey", "status", "leaseExpiresAt"],
      by_access_state: ["connectionKey", "lane", "status"],
    });
  });

  it("reconciles a same-connection reauthorization with the incremented generation", () => {
    const activated = activateSlackConnectionPlan({
      connectionKey: "slack_agency_acme",
      expectedGeneration: 2,
      connection: {
        _id: "providerConnection_reauth",
        connectionKey: "slack_agency_acme",
        organizationKey: "agency_acme",
        connectionGeneration: 2,
        status: "reauthorizing",
        teamId: "T_acme",
        apiAppId: "A_acme",
        botUserId: "B_acme",
        nangoConnectionId: "nango-conn-reauth",
      },
      providerIdentity: {
        teamId: "T_acme",
        apiAppId: "A_acme",
        botUserId: "B_acme",
      },
      now: 2_000,
    });

    expect(Either.isRight(activated)).toBe(true);
    if (Either.isRight(activated)) {
      const planned = reconcileSlackChannelDirectoryPlan({
        connectionKey: "slack_agency_acme",
        expectedGeneration: activated.right.connection.connectionGeneration,
        connection: activated.right.connection,
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
            membershipStatus: "joined_active",
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
          { id: "C_general", name: "general", is_member: true },
        ],
      });
      expect(Either.isRight(planned)).toBe(true);
      if (Either.isRight(planned)) {
        expect(planned.right.upserts[0]).toMatchObject({
          channelKey: "slack_agency_acme:C_general",
          connectionGeneration: 3,
          membershipStatus: "joined_active",
        });
      }
    }
  });

  it("does not reuse a channel row from another connection generation", () => {
    const planned = reconcileSlackChannelDirectoryPlan({
      connectionKey: "slack_agency_acme_new",
      expectedGeneration: 0,
      connection: {
        connectionKey: "slack_agency_acme_new",
        organizationKey: "agency_acme",
        connectionGeneration: 0,
        status: "active",
        teamId: "T_acme",
        apiAppId: "A_acme",
        botUserId: "B_acme",
      },
      existingChannels: [
        SourceChannelRow.make({
          organizationKey: "agency_acme",
          connectionKey: "slack_agency_acme_old",
          connectionGeneration: 2,
          channelKey: "slack_agency_acme_old:C_general",
          externalChannelId: "C_general",
          name: "general",
          normalizedName: "general",
          isMember: true,
          isShared: false,
          isExtShared: false,
          isArchived: false,
          membershipStatus: "joined_active",
          accessGeneration: 7,
          firstDiscoveredAt: 1_000,
          lastSeenAt: 1_000,
          updatedAt: 1_000,
        }),
      ],
      now: 2_000,
      cursor: null,
      limit: 1,
      providerChannels: [{ id: "C_general", name: "general", is_member: true }],
    });

    expect(Either.isRight(planned)).toBe(true);
    if (Either.isRight(planned)) {
      expect(planned.right.upserts[0]).toMatchObject({
        channelKey: "slack_agency_acme_new:C_general",
        connectionKey: "slack_agency_acme_new",
        connectionGeneration: 0,
        accessGeneration: 1,
      });
      expect(planned.right.upserts[0]).not.toHaveProperty("rowId");
    }
  });
  it("rejects inactive lifecycle states before activation", () => {
    for (const status of ["authorizing", "error"] as const) {
      const activated = activateSlackConnectionPlan({
        connectionKey: "slack_agency_acme",
        expectedGeneration: 0,
        connection: {
          _id: `providerConnection_${status}`,
          connectionKey: "slack_agency_acme",
          organizationKey: "agency_acme",
          connectionGeneration: 0,
          status,
          nangoConnectionId: "nango-conn-directory",
        },
        providerIdentity: {
          teamId: "T_acme",
          apiAppId: "A_acme",
          botUserId: "B_acme",
        },
        now: 2_000,
      });

      expect(Either.isLeft(activated)).toBe(true);
      if (Either.isLeft(activated)) {
        expect(activated.left).toMatchObject({ _tag: "ConnectionNotFound" });
      }
    }
  });

  it("plans activation from verifying connection with persisted bot identity", () => {
    const activated = activateSlackConnectionPlan({
      connectionKey: "slack_agency_acme",
      expectedGeneration: 0,
      connection: {
        _id: "providerConnection_verifying",
        connectionKey: "slack_agency_acme",
        organizationKey: "agency_acme",
        connectionGeneration: 0,
        status: "verifying",
        nangoConnectionId: "nango-conn-directory",
      },
      providerIdentity: {
        teamId: "T_acme",
        apiAppId: "A_acme",
        botUserId: "B_acme",
      },
      now: 2_000,
    });

    expect(Either.isRight(activated)).toBe(true);
    if (Either.isRight(activated)) {
      expect(activated.right.connection).toMatchObject({
        status: "active",
        connectionGeneration: 0,
        teamId: "T_acme",
        apiAppId: "A_acme",
        botUserId: "B_acme",
      });
      expect(activated.right.patch).toMatchObject({
        status: "active",
        teamId: "T_acme",
        apiAppId: "A_acme",
        botUserId: "B_acme",
        updatedAt: 2_000,
      });
    }
  });

  it("plans reauthorization as a new generation while preserving channel keys", () => {
    const activated = activateSlackConnectionPlan({
      connectionKey: "slack_agency_acme",
      expectedGeneration: 2,
      connection: {
        _id: "providerConnection_reauth",
        connectionKey: "slack_agency_acme",
        organizationKey: "agency_acme",
        connectionGeneration: 2,
        status: "reauthorizing",
        teamId: "T_acme",
        apiAppId: "A_acme",
        botUserId: "B_acme",
        nangoConnectionId: "nango-conn-reauth",
      },
      providerIdentity: {
        teamId: "T_acme",
        apiAppId: "A_acme",
        botUserId: "B_acme",
      },
      now: 2_000,
    });

    expect(Either.isRight(activated)).toBe(true);
    if (Either.isRight(activated)) {
      expect(activated.right.connection.connectionGeneration).toBe(3);
      expect(activated.right.patch).toMatchObject({
        status: "active",
        connectionGeneration: 3,
      });
    }
  });

  it("plans replacement revocation with paused channel lanes before mismatch failure", () => {
    const revoked = revokeSlackConnectionPlan({
      connectionKey: "slack_agency_acme",
      connection: {
        _id: "providerConnection_active",
        connectionKey: "slack_agency_acme",
        organizationKey: "agency_acme",
        connectionGeneration: 2,
        status: "active",
        teamId: "T_acme",
        apiAppId: "A_acme",
        botUserId: "B_acme",
        nangoConnectionId: "nango-conn-directory",
      },
      reason: "team_or_app_or_bot_changed",
      now: 3_000,
    });

    expect(Either.isRight(revoked)).toBe(true);
    if (Either.isRight(revoked)) {
      expect(revoked.right.connectionPatch).toMatchObject({
        status: "revoked",
        errorReason: "replacement:team_or_app_or_bot_changed",
        updatedAt: 3_000,
      });
      expect(revoked.right.syncPatch).toMatchObject({
        status: "access_lost",
        leaseId: null,
        leaseExpiresAt: null,
        updatedAt: 3_000,
      });
    }
  });

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

  it("plans subsequent fixture pages from the supplied cursor", () => {
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
      cursor: "2",
      limit: 2,
      providerChannels: [
        { id: "C_general", name: "general", is_member: true },
        { id: "C_random", name: "random", is_member: false },
        { id: "C_shared", name: "shared-client", is_member: true },
      ],
    });

    expect(Either.isRight(planned)).toBe(true);
    if (Either.isRight(planned)) {
      expect(planned.right.nextCursor).toBeNull();
      expect(planned.right.upserts).toEqual([
        expect.objectContaining({
          channelKey: "slack_agency_acme:C_shared",
          externalChannelId: "C_shared",
        }),
      ]);
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
        authTest: async () => ({
          teamId: "T_acme",
          apiAppId: "A_acme",
          botUserId: "B_acme",
        }),
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
        confect.action(directoryRefs.reconcile, {
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
        authTest: async () => ({
          teamId: "T_acme",
          apiAppId: "A_acme",
          botUserId: "B_acme",
        }),
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
        confect.action(directoryRefs.reconcile, {
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

  it("verifies provider bot identity before persisting channel state", async () => {
    let listCalls = 0;
    const mismatchFunctions = RegisteredFunctions.buildForGroup<
      typeof slackDirectory
    >(
      transientDatabaseSchema,
      makeSlackDirectoryImpl({
        authTest: async () => ({
          teamId: "T_other",
          apiAppId: "A_acme",
          botUserId: "B_acme",
        }),
        listChannels: async () => {
          listCalls += 1;
          return {
            channels: [{ id: "C_general", name: "general", is_member: true }],
            nextCursor: null,
          };
        },
      }),
      RegisteredConvexFunction.make,
    );
    const mismatchLayer = TestConfect.layer(
      transientDatabaseSchema,
      transientConvexSchema,
      {
        ...import.meta.glob("../convex/**/!(*.*.*)*.*s"),
        "../convex/integrations/slackDirectory.ts": async () =>
          mismatchFunctions,
      },
    );

    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      yield* confect.run(seedConnection(), Id("providerConnections"));
      const mismatch = yield* Effect.either(
        confect.action(directoryRefs.reconcile, {
          connectionKey: "slack_agency_acme",
          expectedGeneration: 2,
          cursor: null,
          limit: 1,
        }),
      );
      expect(Either.isLeft(mismatch)).toBe(true);
      if (Either.isLeft(mismatch)) {
        expect(mismatch.left).toMatchObject({
          _tag: "BotIdentityMismatch",
          connectionKey: "slack_agency_acme",
        });
      }
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
              ) => { take: (count: number) => Effect.Effect<unknown, unknown> };
            };
          };
          return yield* raw
            .table("sourceChannels")
            .index("by_connection_generation", (q) =>
              q.eq("connectionKey", "slack_agency_acme"),
            )
            .take(10)
            .pipe(Effect.orDie);
        }),
        Schema.Any,
      );
      expect(rows).toEqual([]);
    });

    await Effect.runPromise(program.pipe(Effect.provide(mismatchLayer())));
    expect(listCalls).toBe(0);
  });

  it("reconciles persisted rows after same-connection reauthorization increments generation", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      yield* confect.run(
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
              status: "reauthorizing" as const,
              connectSessionId: "maestro-session-reauth",
              nangoConnectionId: "nango-conn-reauth",
              nangoEndUserId: "nango-user-reauth",
              nangoOrganizationId: "nango-org-reauth",
              correlationTag: "slack-connect:maestro-session-reauth",
              attemptId: "attempt_reauth",
              attemptExpiresAt: 2_000,
              completedAt: 1_000,
              teamId: "T_acme",
              apiAppId: "A_acme",
              botUserId: "B_acme",
              createdAt: 1_000,
              updatedAt: 1_000,
            })
            .pipe(Effect.orDie);
        }),
        Id("providerConnections"),
      );

      const result = yield* confect.action(directoryRefs.reconcile, {
        connectionKey: "slack_agency_acme",
        expectedGeneration: 2,
        cursor: null,
        limit: 1,
      });
      expect(result).toMatchObject({ upserted: 1, accessGained: 1 });

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
              ) => { first: () => Effect.Effect<unknown, unknown> };
            };
          };
          const connection = yield* raw
            .table("providerConnections")
            .index("by_connection_key", (q) =>
              q.eq("connectionKey", "slack_agency_acme"),
            )
            .first()
            .pipe(Effect.orDie);
          const channel = yield* raw
            .table("sourceChannels")
            .index("by_channel_key", (q) =>
              q.eq("channelKey", "slack_agency_acme:C_general"),
            )
            .first()
            .pipe(Effect.orDie);
          const connectionValue =
            "value" in (connection as object)
              ? (connection as { value: unknown }).value
              : connection;
          const channelValue =
            "value" in (channel as object)
              ? (channel as { value: unknown }).value
              : channel;
          return { connection: connectionValue, channel: channelValue };
        }),
        Schema.Any,
      );
      expect(rows.connection).toMatchObject({
        status: "active",
        connectionGeneration: 3,
      });
      expect(rows.channel).toMatchObject({
        channelKey: "slack_agency_acme:C_general",
        connectionGeneration: 3,
      });
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(slackDirectoryTestLayer())),
    );
  });

  it("preserves all old-generation channel cursors when reauthorization starts with a partial page", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          const rawWriter = writer as unknown as {
            table: (name: string) => {
              insert: (row: unknown) => Effect.Effect<unknown, unknown>;
            };
          };
          yield* rawWriter
            .table("providerConnections")
            .insert({
              provider: "nango" as const,
              providerConfigKey: "slack",
              organizationKey: "agency_acme",
              connectionKey: "slack_agency_acme",
              connectionGeneration: 2,
              status: "reauthorizing" as const,
              connectSessionId: "maestro-session-reauth-partial",
              nangoConnectionId: "nango-conn-reauth-partial",
              nangoEndUserId: "nango-user-reauth-partial",
              nangoOrganizationId: "nango-org-reauth-partial",
              correlationTag: "slack-connect:maestro-session-reauth-partial",
              attemptId: "attempt_reauth_partial",
              attemptExpiresAt: 2_000,
              completedAt: 1_000,
              teamId: "T_acme",
              apiAppId: "A_acme",
              botUserId: "B_acme",
              createdAt: 1_000,
              updatedAt: 1_000,
            })
            .pipe(Effect.orDie);
          const channels = [
            { id: "C_general", name: "general", isMember: true },
            { id: "C_random", name: "random", isMember: false },
            ...Array.from({ length: 999 }, (_, index) => ({
              id: `C_extra_${index}`,
              name: `extra-${index}`,
              isMember: false,
            })),
          ];
          for (const channel of channels) {
            yield* rawWriter
              .table("sourceChannels")
              .insert({
                organizationKey: "agency_acme",
                connectionKey: "slack_agency_acme",
                connectionGeneration: 2,
                channelKey: `slack_agency_acme:${channel.id}`,
                externalChannelId: channel.id,
                name: channel.name,
                normalizedName: channel.name,
                isMember: channel.isMember,
                isShared: false,
                isExtShared: false,
                isArchived: false,
                membershipStatus: channel.isMember
                  ? ("joined_active" as const)
                  : ("discovered_not_joined" as const),
                accessGeneration: channel.isMember ? 1 : 0,
                firstDiscoveredAt: 1_000,
                lastSeenAt: 1_000,
                updatedAt: 1_000,
              })
              .pipe(Effect.orDie);
            if (channel.id !== "C_extra_998") continue;
            for (const lane of [
              "live",
              "recent",
              "deep",
              "reconciliation",
            ] as const) {
              yield* rawWriter
                .table("channelSyncStates")
                .insert({
                  organizationKey: "agency_acme",
                  connectionKey: "slack_agency_acme",
                  connectionGeneration: 2,
                  channelKey: `slack_agency_acme:${channel.id}`,
                  lane,
                  status: "running" as const,
                  cursor: `${lane}-cursor`,
                  leaseId: `${lane}-lease`,
                  leaseExpiresAt: 1_800,
                  lastProgressAt: 1_500,
                  createdAt: 1_000,
                  updatedAt: 1_000,
                })
                .pipe(Effect.orDie);
            }
          }
        }),
        Schema.Any,
      );

      yield* confect.action(directoryRefs.reconcile, {
        connectionKey: "slack_agency_acme",
        expectedGeneration: 2,
        cursor: null,
        limit: 1,
      });

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
              ) => { take: (count: number) => Effect.Effect<unknown, unknown> };
            };
          };
          const channels = yield* raw
            .table("sourceChannels")
            .index("by_connection_generation", (q) =>
              q.eq("connectionKey", "slack_agency_acme"),
            )
            .take(1_200)
            .pipe(Effect.orDie);
          const syncs = yield* raw
            .table("channelSyncStates")
            .index("by_channel", (q) =>
              q.eq("channelKey", "slack_agency_acme:C_extra_998"),
            )
            .take(10)
            .pipe(Effect.orDie);
          return { channels, syncs: JSON.parse(JSON.stringify(syncs)) };
        }),
        Schema.Any,
      );
      expect(rows.channels).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            channelKey: "slack_agency_acme:C_general",
            connectionGeneration: 3,
          }),
          expect.objectContaining({
            channelKey: "slack_agency_acme:C_random",
            connectionGeneration: 3,
          }),
          expect.objectContaining({
            channelKey: "slack_agency_acme:C_extra_998",
            connectionGeneration: 3,
          }),
        ]),
      );
      expect(rows.syncs).toEqual(
        expect.arrayContaining([
          ...["live", "recent", "deep", "reconciliation"].map((lane) =>
            expect.objectContaining({
              channelKey: "slack_agency_acme:C_extra_998",
              connectionGeneration: 3,
              lane,
              status: "running",
              cursor: `${lane}-cursor`,
              leaseId: `${lane}-lease`,
              leaseExpiresAt: 1_800,
              lastProgressAt: 1_500,
            }),
          ),
        ]),
      );
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(slackDirectoryTestLayer())),
    );
  }, 30_000);

  it("activates a verifying connection before writing channel rows", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      yield* confect.run(seedVerifyingConnection(), Id("providerConnections"));

      const result = yield* confect.action(directoryRefs.reconcile, {
        connectionKey: "slack_agency_acme",
        expectedGeneration: 0,
        cursor: null,
        limit: 1,
      });
      expect(result).toMatchObject({ upserted: 1, accessGained: 1 });

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
              ) => { first: () => Effect.Effect<unknown, unknown> };
            };
          };
          const connection = yield* raw
            .table("providerConnections")
            .index("by_connection_key", (q) =>
              q.eq("connectionKey", "slack_agency_acme"),
            )
            .first()
            .pipe(Effect.orDie);
          const channel = yield* raw
            .table("sourceChannels")
            .index("by_channel_key", (q) =>
              q.eq("channelKey", "slack_agency_acme:C_general"),
            )
            .first()
            .pipe(Effect.orDie);
          const connectionValue =
            "value" in (connection as object)
              ? (connection as { value: unknown }).value
              : connection;
          const channelValue =
            "value" in (channel as object)
              ? (channel as { value: unknown }).value
              : channel;
          return { connection: connectionValue, channel: channelValue };
        }),
        Schema.Any,
      );
      expect(rows.connection).toMatchObject({
        status: "active",
        teamId: "T_acme",
        apiAppId: "A_acme",
        botUserId: "B_acme",
      });
      expect(rows.channel).toMatchObject({
        connectionGeneration: 0,
        channelKey: "slack_agency_acme:C_general",
      });
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(slackDirectoryTestLayer())),
    );
  });

  it("persists bot identity, channel rows, independent cursors, and generation fences", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      yield* confect.run(seedConnection(), Id("providerConnections"));

      const first = yield* confect.action(directoryRefs.reconcile, {
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
            .index("by_channel", (q) =>
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
      const replay = yield* confect.action(directoryRefs.reconcile, {
        connectionKey: "slack_agency_acme",
        expectedGeneration: 2,
        cursor: null,
        limit: 1,
      });
      expect(replay).toMatchObject({ upserted: 1, nextCursor: "1" });
      const second = yield* confect.action(directoryRefs.reconcile, {
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
            .index("by_channel", (q) =>
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
        confect.action(directoryRefs.reconcile, {
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

  it("rejects duplicate active Slack team/app/bot binding across agencies", async () => {
    let listCalls = 0;
    const duplicateFunctions = RegisteredFunctions.buildForGroup<
      typeof slackDirectory
    >(
      transientDatabaseSchema,
      makeSlackDirectoryImpl({
        authTest: async () => ({
          teamId: "T_acme",
          apiAppId: "A_acme",
          botUserId: "B_acme",
        }),
        listChannels: async () => {
          listCalls += 1;
          return { channels: [], nextCursor: null };
        },
      }),
      RegisteredConvexFunction.make,
    );
    const duplicateLayer = TestConfect.layer(
      transientDatabaseSchema,
      transientConvexSchema,
      {
        ...import.meta.glob("../convex/**/!(*.*.*)*.*s"),
        "../convex/integrations/slackDirectory.ts": async () =>
          duplicateFunctions,
      },
    );

    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      yield* confect.run(seedVerifyingConnection(), Id("providerConnections"));
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          yield* writer
            .table("providerConnections")
            .insert({
              provider: "nango" as const,
              providerConfigKey: "slack",
              organizationKey: "agency_other",
              connectionKey: "slack_agency_other_duplicate",
              connectionGeneration: 4,
              status: "active" as const,
              connectSessionId: "maestro-session-other",
              nangoConnectionId: "nango-conn-other",
              nangoEndUserId: "nango-user-other",
              nangoOrganizationId: "nango-org-other",
              correlationTag: "slack-connect:maestro-session-other",
              attemptId: "attempt_other",
              attemptExpiresAt: 2_000,
              completedAt: 1_000,
              teamId: "T_acme",
              apiAppId: "A_acme",
              botUserId: "B_acme",
              createdAt: 1_000,
              updatedAt: 1_000,
            })
            .pipe(Effect.orDie);
        }),
        Schema.Any,
      );

      const duplicate = yield* Effect.either(
        confect.action(directoryRefs.reconcile, {
          connectionKey: "slack_agency_acme",
          expectedGeneration: 0,
          cursor: null,
          limit: 1,
        }),
      );
      expect(Either.isLeft(duplicate)).toBe(true);
      if (Either.isLeft(duplicate)) {
        expect(duplicate.left).toMatchObject({ _tag: "BotIdentityMismatch" });
      }
    });

    await Effect.runPromise(program.pipe(Effect.provide(duplicateLayer())));
    expect(listCalls).toBe(0);
  });

  it("rejects duplicate active Slack binding past the initial connection page", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      yield* confect.run(seedVerifyingConnection(), Id("providerConnections"));
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          for (let index = 0; index < 10_001; index += 1) {
            yield* writer
              .table("providerConnections")
              .insert({
                provider: "nango" as const,
                providerConfigKey: "slack",
                organizationKey: `agency_filler_${index}`,
                connectionKey: `slack_agency_filler_${index}`,
                connectionGeneration: 1,
                status: "active" as const,
                connectSessionId: `maestro-session-filler-${index}`,
                nangoConnectionId: `nango-conn-filler-${index}`,
                nangoEndUserId: `nango-user-filler-${index}`,
                nangoOrganizationId: `nango-org-filler-${index}`,
                correlationTag: `slack-connect:maestro-session-filler-${index}`,
                attemptId: `attempt_filler_${index}`,
                attemptExpiresAt: 2_000,
                completedAt: 1_000,
                teamId: `T_filler_${index}`,
                apiAppId: "A_acme",
                botUserId: "B_acme",
                createdAt: 1_000,
                updatedAt: 1_000,
              })
              .pipe(Effect.orDie);
          }
          yield* writer
            .table("providerConnections")
            .insert({
              provider: "nango" as const,
              providerConfigKey: "slack",
              organizationKey: "agency_other",
              connectionKey: "slack_agency_other_duplicate_after_page",
              connectionGeneration: 4,
              status: "active" as const,
              connectSessionId: "maestro-session-other-after-page",
              nangoConnectionId: "nango-conn-other-after-page",
              nangoEndUserId: "nango-user-other-after-page",
              nangoOrganizationId: "nango-org-other-after-page",
              correlationTag: "slack-connect:maestro-session-other-after-page",
              attemptId: "attempt_other_after_page",
              attemptExpiresAt: 2_000,
              completedAt: 1_000,
              teamId: "T_acme",
              apiAppId: "A_acme",
              botUserId: "B_acme",
              createdAt: 1_000,
              updatedAt: 1_000,
            })
            .pipe(Effect.orDie);
        }),
        Schema.Any,
      );

      const duplicate = yield* Effect.either(
        confect.action(directoryRefs.reconcile, {
          connectionKey: "slack_agency_acme",
          expectedGeneration: 0,
          cursor: null,
          limit: 1,
        }),
      );
      expect(Either.isLeft(duplicate)).toBe(true);
      if (Either.isLeft(duplicate)) {
        expect(duplicate.left).toMatchObject({ _tag: "BotIdentityMismatch" });
      }
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(slackDirectoryTestLayer())),
    );
  }, 30_000);

  it("does not call the provider or write channels for inactive lifecycle states", async () => {
    let authCalls = 0;
    let listCalls = 0;
    const inactiveFunctions = RegisteredFunctions.buildForGroup<
      typeof slackDirectory
    >(
      transientDatabaseSchema,
      makeSlackDirectoryImpl({
        authTest: async () => {
          authCalls += 1;
          return {
            teamId: "T_acme",
            apiAppId: "A_acme",
            botUserId: "B_acme",
          };
        },
        listChannels: async () => {
          listCalls += 1;
          return { channels: [], nextCursor: null };
        },
      }),
      RegisteredConvexFunction.make,
    );
    const inactiveLayer = TestConfect.layer(
      transientDatabaseSchema,
      transientConvexSchema,
      {
        ...import.meta.glob("../convex/**/!(*.*.*)*.*s"),
        "../convex/integrations/slackDirectory.ts": async () =>
          inactiveFunctions,
      },
    );

    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          return yield* writer
            .table("providerConnections")
            .insert({
              provider: "nango" as const,
              providerConfigKey: "slack",
              organizationKey: "agency_acme",
              connectionKey: "slack_agency_acme",
              connectionGeneration: 0,
              status: "error" as const,
              connectSessionId: "maestro-session-error",
              nangoConnectionId: "nango-conn-error",
              nangoEndUserId: "nango-user-error",
              nangoOrganizationId: "nango-org-error",
              correlationTag: "slack-connect:maestro-session-error",
              attemptId: "attempt_error",
              attemptExpiresAt: 2_000,
              completedAt: 1_000,
              teamId: "T_acme",
              apiAppId: "A_acme",
              botUserId: "B_acme",
              errorReason: "initial_reconciliation_failed",
              createdAt: 1_000,
              updatedAt: 1_000,
            })
            .pipe(Effect.orDie);
        }),
        Id("providerConnections"),
      );

      const inactive = yield* Effect.either(
        confect.action(directoryRefs.reconcile, {
          connectionKey: "slack_agency_acme",
          expectedGeneration: 0,
          cursor: null,
          limit: 1,
        }),
      );
      expect(Either.isLeft(inactive)).toBe(true);
      if (Either.isLeft(inactive)) {
        expect(inactive.left).toMatchObject({ _tag: "ConnectionNotFound" });
      }

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
              ) => { take: (count: number) => Effect.Effect<unknown, unknown> };
            };
          };
          return yield* raw
            .table("sourceChannels")
            .index("by_connection_generation", (q) =>
              q.eq("connectionKey", "slack_agency_acme"),
            )
            .take(10)
            .pipe(Effect.orDie);
        }),
        Schema.Any,
      );
      expect(rows).toEqual([]);
    });

    await Effect.runPromise(program.pipe(Effect.provide(inactiveLayer())));
    expect(authCalls).toBe(0);
    expect(listCalls).toBe(0);
  });

  it("keeps verifying connection in error when initial channel listing fails", async () => {
    const failingFunctions = RegisteredFunctions.buildForGroup<
      typeof slackDirectory
    >(
      transientDatabaseSchema,
      makeSlackDirectoryImpl({
        authTest: async () => ({
          teamId: "T_acme",
          apiAppId: "A_acme",
          botUserId: "B_acme",
        }),
        listChannels: async () => {
          throw new ProviderRateLimited({ retryAfterMs: 1_500 });
        },
      }),
      RegisteredConvexFunction.make,
    );
    const failingLayer = TestConfect.layer(
      transientDatabaseSchema,
      transientConvexSchema,
      {
        ...import.meta.glob("../convex/**/!(*.*.*)*.*s"),
        "../convex/integrations/slackDirectory.ts": async () =>
          failingFunctions,
      },
    );

    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      yield* confect.run(seedVerifyingConnection(), Id("providerConnections"));
      const failed = yield* confect.action(directoryRefs.reconcile, {
        connectionKey: "slack_agency_acme",
        expectedGeneration: 0,
        cursor: null,
        limit: 1,
      });
      expect(failed).toMatchObject({ upserted: 0, nextCursor: null });

      const connection = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const raw = reader as unknown as {
            table: (name: string) => {
              index: (
                name: string,
                range: (q: {
                  eq: (field: string, value: unknown) => unknown;
                }) => unknown,
              ) => { first: () => Effect.Effect<unknown, unknown> };
            };
          };
          const row = yield* raw
            .table("providerConnections")
            .index("by_connection_key", (q) =>
              q.eq("connectionKey", "slack_agency_acme"),
            )
            .first()
            .pipe(Effect.orDie);
          return "value" in (row as object)
            ? (row as { value: unknown }).value
            : row;
        }),
        Schema.Any,
      );
      expect(connection).toMatchObject({
        status: "error",
        errorReason: "initial_reconciliation_failed",
      });
    });

    await Effect.runPromise(program.pipe(Effect.provide(failingLayer())));
  });

  it("commits replacement audit before the outer typed mismatch failure", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      yield* confect.run(seedConnection(), Id("providerConnections"));
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          const rawWriter = writer as unknown as {
            table: (name: string) => {
              insert: (row: unknown) => Effect.Effect<unknown, unknown>;
            };
          };
          yield* rawWriter
            .table("sourceChannels")
            .insert({
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
              membershipStatus: "joined_active" as const,
              accessGeneration: 1,
              firstDiscoveredAt: 1_000,
              lastSeenAt: 2_000,
              updatedAt: 2_000,
            })
            .pipe(Effect.orDie);
          yield* rawWriter
            .table("channelSyncStates")
            .insert({
              organizationKey: "agency_acme",
              connectionKey: "slack_agency_acme",
              connectionGeneration: 2,
              channelKey: "slack_agency_acme:C_general",
              lane: "live" as const,
              status: "running" as const,
              cursor: "ts-1",
              leaseId: "lease-1",
              leaseExpiresAt: 2_500,
              lastProgressAt: 2_100,
              createdAt: 2_000,
              updatedAt: 2_000,
            })
            .pipe(Effect.orDie);
          yield* rawWriter
            .table("channelSyncStates")
            .insert({
              organizationKey: "agency_acme",
              connectionKey: "slack_agency_acme",
              connectionGeneration: 2,
              channelKey: "slack_agency_acme:C_general",
              lane: "recent" as const,
              status: "queued" as const,
              cursor: "cursor-recent",
              leaseId: "lease-recent",
              leaseExpiresAt: 2_600,
              lastProgressAt: 2_100,
              createdAt: 2_000,
              updatedAt: 2_000,
            })
            .pipe(Effect.orDie);
        }),
        Schema.Any,
      );

      const mismatch = yield* Effect.either(
        confect.action(directoryRefs.reconcile, {
          connectionKey: "slack_agency_acme",
          expectedGeneration: 2,
          cursor: null,
          limit: 1,
        }),
      );
      expect(Either.isLeft(mismatch)).toBe(true);
      if (Either.isLeft(mismatch)) {
        expect(mismatch.left).toMatchObject({
          _tag: "BotIdentityMismatch",
          connectionKey: "slack_agency_acme",
        });
      }

      const rows = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const raw = reader as unknown as {
            table: (name: string) => {
              index: (
                name: string,
                range: (q: {
                  eq: (
                    field: string,
                    value: unknown,
                  ) => {
                    eq: (field: string, value: unknown) => unknown;
                  };
                }) => unknown,
              ) => { take: (count: number) => Effect.Effect<unknown, unknown> };
            };
          };
          const syncRows = yield* raw
            .table("channelSyncStates")
            .index("by_access_state", (q) =>
              q.eq("connectionKey", "slack_agency_acme").eq("lane", "live"),
            )
            .take(10)
            .pipe(Effect.orDie);
          const recentRows = yield* raw
            .table("channelSyncStates")
            .index("by_access_state", (q) =>
              q.eq("connectionKey", "slack_agency_acme").eq("lane", "recent"),
            )
            .take(10)
            .pipe(Effect.orDie);
          const channels = yield* raw
            .table("sourceChannels")
            .index("by_connection_generation", (q) =>
              q
                .eq("connectionKey", "slack_agency_acme")
                .eq("connectionGeneration", 2),
            )
            .take(10)
            .pipe(Effect.orDie);
          return { syncRows, recentRows, channels };
        }),
        Schema.Any,
      );
      const live = JSON.parse(JSON.stringify(rows.syncRows[0]));
      const recent = JSON.parse(JSON.stringify(rows.recentRows[0]));
      expect(live).toMatchObject({
        status: "access_lost",
        leaseId: null,
        replacementAudit: expect.objectContaining({
          reason: "team_or_app_or_bot_changed",
        }),
      });
      expect(recent).toMatchObject({ status: "access_lost", leaseId: null });
      expect(JSON.parse(JSON.stringify(rows.channels[0]))).toMatchObject({
        isMember: false,
        membershipStatus: "access_lost",
      });
    });

    let listCalls = 0;
    const mismatchLayer = TestConfect.layer(
      transientDatabaseSchema,
      transientConvexSchema,
      {
        ...import.meta.glob("../convex/**/!(*.*.*)*.*s"),
        "../convex/integrations/slackDirectory.ts": async () =>
          RegisteredFunctions.buildForGroup<typeof slackDirectory>(
            transientDatabaseSchema,
            makeSlackDirectoryImpl({
              authTest: async () => ({
                teamId: "T_other",
                apiAppId: "A_acme",
                botUserId: "B_acme",
              }),
              listChannels: async () => {
                listCalls += 1;
                return { channels: [], nextCursor: null };
              },
            }),
            RegisteredConvexFunction.make,
          ),
      },
    );

    await Effect.runPromise(program.pipe(Effect.provide(mismatchLayer())));
    expect(listCalls).toBe(0);
  });

  it("full action revokes reauthorizing mismatch and pauses every lane", async () => {
    const lanes = ["live", "recent", "deep", "reconciliation"] as const;
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      yield* confect.run(
        Effect.gen(function* () {
          const rawWriter = (yield* DatabaseWriter) as unknown as {
            table: (name: string) => {
              insert: (row: unknown) => Effect.Effect<unknown, unknown>;
            };
          };
          const insert = (table: string, row: Record<string, unknown>) =>
            rawWriter.table(table).insert(row).pipe(Effect.orDie);
          yield* insert("providerConnections", {
            provider: "nango",
            providerConfigKey: "slack",
            organizationKey: "agency_acme",
            connectionKey: "slack_agency_acme",
            connectionGeneration: 2,
            status: "reauthorizing",
            connectSessionId: "maestro-session-reauth-mismatch",
            nangoConnectionId: "nango-conn-reauth-mismatch",
            nangoEndUserId: "nango-user-reauth-mismatch",
            nangoOrganizationId: "nango-org-reauth-mismatch",
            correlationTag: "slack-connect:maestro-session-reauth-mismatch",
            attemptId: "attempt_reauth_mismatch",
            attemptExpiresAt: 2_000,
            completedAt: 1_000,
            teamId: "T_acme",
            apiAppId: "A_acme",
            botUserId: "B_acme",
            createdAt: 1_000,
            updatedAt: 1_000,
          });
          yield* insert("sourceChannels", {
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
            membershipStatus: "joined_active",
            accessGeneration: 1,
            firstDiscoveredAt: 1_000,
            lastSeenAt: 2_000,
            updatedAt: 2_000,
          });
          for (const lane of lanes) {
            yield* insert("channelSyncStates", {
              organizationKey: "agency_acme",
              connectionKey: "slack_agency_acme",
              connectionGeneration: 2,
              channelKey: `slack_agency_acme:C_general:${lane}`,
              lane,
              status: "running",
              cursor: `cursor-${lane}`,
              leaseId: `lease-${lane}`,
              leaseExpiresAt: 2_500,
              lastProgressAt: 2_100,
              createdAt: 2_000,
              updatedAt: 2_000,
            });
          }
        }),
        Schema.Any,
      );

      const mismatch = yield* Effect.either(
        confect.action(directoryRefs.reconcile, {
          connectionKey: "slack_agency_acme",
          expectedGeneration: 2,
          cursor: null,
          limit: 1,
        }),
      );
      expect(Either.isLeft(mismatch)).toBe(true);
      if (Either.isLeft(mismatch)) {
        expect(mismatch.left).toMatchObject({ _tag: "BotIdentityMismatch" });
      }

      const rows = yield* confect.run(
        Effect.gen(function* () {
          const raw = (yield* DatabaseReader) as unknown as {
            table: (name: string) => {
              index: (
                name: string,
                range: (q: {
                  eq: (
                    field: string,
                    value: unknown,
                  ) => { eq: (field: string, value: unknown) => unknown };
                }) => unknown,
              ) => {
                first: () => Effect.Effect<unknown, unknown>;
                take: (count: number) => Effect.Effect<unknown, unknown>;
              };
            };
          };
          const byAccessState = (lane: string) =>
            raw
              .table("channelSyncStates")
              .index("by_access_state", (q) =>
                q.eq("connectionKey", "slack_agency_acme").eq("lane", lane),
              )
              .take(10)
              .pipe(Effect.orDie);
          return {
            connection: yield* raw
              .table("providerConnections")
              .index("by_connection_key", (q) =>
                q.eq("connectionKey", "slack_agency_acme"),
              )
              .first()
              .pipe(Effect.orDie),
            channels: yield* raw
              .table("sourceChannels")
              .index("by_connection_generation", (q) =>
                q
                  .eq("connectionKey", "slack_agency_acme")
                  .eq("connectionGeneration", 2),
              )
              .take(10)
              .pipe(Effect.orDie),
            syncRows: yield* Effect.all(lanes.map(byAccessState)).pipe(
              Effect.map((groups) => groups.flat()),
            ),
          };
        }),
        Schema.Any,
      );
      const rowValue = (row: unknown) => {
        const json = JSON.parse(JSON.stringify(row));
        return "value" in json ? json.value : json;
      };
      const connection = rowValue(rows.connection) as {
        readonly status?: string;
        readonly errorReason?: string | null;
      };
      expect(connection.status).toBe("revoked");
      expect(connection.errorReason).toBe(
        "replacement:team_or_app_or_bot_changed",
      );
      const channel = rowValue(rows.channels[0]) as {
        readonly isMember?: boolean;
        readonly membershipStatus?: string;
      };
      expect(channel.isMember).toBe(false);
      expect(channel.membershipStatus).toBe("access_lost");
      const syncRowValues = rows.syncRows.map(rowValue) as Array<{
        readonly status?: string;
        readonly leaseId?: string | null;
        readonly leaseExpiresAt?: number | null;
        readonly replacementAudit?: Record<string, unknown> | null;
      }>;
      expect(syncRowValues).toHaveLength(4);
      for (const sync of syncRowValues) {
        expect(sync.status).toBe("access_lost");
        expect(sync.leaseId).toBeNull();
        expect(sync.leaseExpiresAt).toBeNull();
        expect(sync.replacementAudit).toMatchObject({
          connectionKey: "slack_agency_acme",
          connectionGeneration: 2,
          reason: "team_or_app_or_bot_changed",
        });
      }
    });

    let listCalls = 0;
    const mismatchLayer = TestConfect.layer(
      transientDatabaseSchema,
      transientConvexSchema,
      {
        ...import.meta.glob("../convex/**/!(*.*.*)*.*s"),
        "../convex/integrations/slackDirectory.ts": async () =>
          RegisteredFunctions.buildForGroup<typeof slackDirectory>(
            transientDatabaseSchema,
            makeSlackDirectoryImpl({
              authTest: async () => ({
                teamId: "T_other",
                apiAppId: "A_acme",
                botUserId: "B_acme",
              }),
              listChannels: async () => {
                listCalls += 1;
                return { channels: [], nextCursor: null };
              },
            }),
            RegisteredConvexFunction.make,
          ),
      },
    );

    await Effect.runPromise(program.pipe(Effect.provide(mismatchLayer())));
    expect(listCalls).toBe(0);
  });

  it("replacement revocation drains rows beyond one query page", async () => {
    const lanes = ["live", "recent", "deep", "reconciliation"] as const;
    const rowCount = 1_005;
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      yield* confect.run(
        Effect.gen(function* () {
          const rawWriter = (yield* DatabaseWriter) as unknown as {
            table: (name: string) => {
              insert: (row: unknown) => Effect.Effect<unknown, unknown>;
            };
          };
          const insert = (table: string, row: Record<string, unknown>) =>
            rawWriter.table(table).insert(row).pipe(Effect.orDie);
          yield* insert("providerConnections", {
            provider: "nango",
            providerConfigKey: "slack",
            organizationKey: "agency_acme",
            connectionKey: "slack_agency_acme",
            connectionGeneration: 2,
            status: "active",
            connectSessionId: "maestro-session-large-revocation",
            nangoConnectionId: "nango-conn-large-revocation",
            nangoEndUserId: "nango-user-large-revocation",
            nangoOrganizationId: "nango-org-large-revocation",
            correlationTag: "slack-connect:maestro-session-large-revocation",
            attemptId: "attempt_large_revocation",
            attemptExpiresAt: 2_000,
            completedAt: 1_000,
            teamId: "T_acme",
            apiAppId: "A_acme",
            botUserId: "B_acme",
            createdAt: 1_000,
            updatedAt: 1_000,
          });
          for (let index = 0; index < rowCount; index += 1) {
            const channelKey = `slack_agency_acme:C_large_${index}`;
            yield* insert("sourceChannels", {
              organizationKey: "agency_acme",
              connectionKey: "slack_agency_acme",
              connectionGeneration: 2,
              channelKey,
              externalChannelId: `C_large_${index}`,
              name: `large-${index}`,
              normalizedName: `large-${index}`,
              isMember: true,
              isShared: false,
              isExtShared: false,
              isArchived: false,
              membershipStatus: "joined_active",
              accessGeneration: 1,
              firstDiscoveredAt: 1_000,
              lastSeenAt: 2_000,
              updatedAt: 2_000,
            });
            for (const lane of lanes) {
              yield* insert("channelSyncStates", {
                organizationKey: "agency_acme",
                connectionKey: "slack_agency_acme",
                connectionGeneration: 2,
                channelKey: `${channelKey}:${lane}`,
                lane,
                status: "running",
                cursor: `cursor-${index}-${lane}`,
                leaseId: `lease-${index}-${lane}`,
                leaseExpiresAt: 2_500,
                lastProgressAt: 2_100,
                createdAt: 2_000,
                updatedAt: 2_000,
              });
            }
          }
        }),
        Schema.Any,
      );

      const mismatch = yield* Effect.either(
        confect.action(directoryRefs.reconcile, {
          connectionKey: "slack_agency_acme",
          expectedGeneration: 2,
          cursor: null,
          limit: 1,
        }),
      );
      expect(Either.isLeft(mismatch)).toBe(true);

      const rows = yield* confect.run(
        Effect.gen(function* () {
          const raw = (yield* DatabaseReader) as unknown as {
            table: (name: string) => {
              index: (
                name: string,
                range: (q: {
                  eq: (
                    field: string,
                    value: unknown,
                  ) => { eq: (field: string, value: unknown) => unknown };
                }) => unknown,
              ) => { collect: () => Effect.Effect<unknown, unknown> };
            };
          };
          const channels = yield* raw
            .table("sourceChannels")
            .index("by_connection_generation", (q) =>
              q
                .eq("connectionKey", "slack_agency_acme")
                .eq("connectionGeneration", 2),
            )
            .collect()
            .pipe(Effect.orDie);
          const syncRows = yield* Effect.all(
            lanes.map((lane) =>
              raw
                .table("channelSyncStates")
                .index("by_access_state", (q) =>
                  q.eq("connectionKey", "slack_agency_acme").eq("lane", lane),
                )
                .collect()
                .pipe(Effect.orDie),
            ),
          ).pipe(Effect.map((groups) => groups.flat()));
          return { channels, syncRows };
        }),
        Schema.Any,
      );
      const rowValue = (row: unknown) => {
        const json = JSON.parse(JSON.stringify(row));
        return "value" in json ? json.value : json;
      };
      const channels = rows.channels.map(rowValue) as Array<{
        readonly isMember?: boolean;
        readonly membershipStatus?: string;
      }>;
      const syncRows = rows.syncRows.map(rowValue) as Array<{
        readonly status?: string;
        readonly leaseId?: string | null;
        readonly replacementAudit?: Record<string, unknown> | null;
      }>;
      expect(channels).toHaveLength(rowCount);
      expect(syncRows).toHaveLength(rowCount * lanes.length);
      expect(
        channels.every((row) => row.membershipStatus === "access_lost"),
      ).toBe(true);
      expect(channels.every((row) => row.isMember === false)).toBe(true);
      expect(syncRows.every((row) => row.status === "access_lost")).toBe(true);
      expect(syncRows.every((row) => row.leaseId === null)).toBe(true);
      expect(
        syncRows.every(
          (row) =>
            row.replacementAudit?.reason === "team_or_app_or_bot_changed",
        ),
      ).toBe(true);
    });

    let listCalls = 0;
    const mismatchLayer = TestConfect.layer(
      transientDatabaseSchema,
      transientConvexSchema,
      {
        ...import.meta.glob("../convex/**/!(*.*.*)*.*s"),
        "../convex/integrations/slackDirectory.ts": async () =>
          RegisteredFunctions.buildForGroup<typeof slackDirectory>(
            transientDatabaseSchema,
            makeSlackDirectoryImpl({
              authTest: async () => ({
                teamId: "T_other",
                apiAppId: "A_acme",
                botUserId: "B_acme",
              }),
              listChannels: async () => {
                listCalls += 1;
                return { channels: [], nextCursor: null };
              },
            }),
            RegisteredConvexFunction.make,
          ),
      },
    );

    await Effect.runPromise(program.pipe(Effect.provide(mismatchLayer())));
    expect(listCalls).toBe(0);
  }, 30_000);

  it("revalidates generation inside replacement commit", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          return yield* writer
            .table("providerConnections")
            .insert({
              provider: "nango" as const,
              providerConfigKey: "slack",
              organizationKey: "agency_acme",
              connectionKey: "slack_agency_acme",
              connectionGeneration: 3,
              status: "active" as const,
              connectSessionId: "maestro-session-raced",
              nangoConnectionId: "nango-conn-raced",
              nangoEndUserId: "nango-user-raced",
              nangoOrganizationId: "nango-org-raced",
              correlationTag: "slack-connect:maestro-session-raced",
              attemptId: "attempt_raced",
              attemptExpiresAt: 2_000,
              completedAt: 1_000,
              teamId: "T_acme",
              apiAppId: "A_acme",
              botUserId: "B_acme",
              createdAt: 1_000,
              updatedAt: 1_000,
            })
            .pipe(Effect.orDie);
        }),
        Id("providerConnections"),
      );
      const raced = yield* Effect.either(
        confect.mutation(directoryRefs.commitIdentity, {
          connectionKey: "slack_agency_acme",
          expectedGeneration: 2,
          providerIdentity: {
            teamId: "T_other",
            apiAppId: "A_acme",
            botUserId: "B_acme",
          },
        }),
      );
      expect(Either.isLeft(raced)).toBe(true);
      if (Either.isLeft(raced)) {
        expect(raced.left).toMatchObject({
          _tag: "ConnectionGenerationMismatch",
        });
      }
    });
    await Effect.runPromise(
      program.pipe(Effect.provide(slackDirectoryTestLayer())),
    );
  });

  it("commits duplicate race audit with one controlled transaction time", async () => {
    const fixedNow = 1_782_864_000_000;
    const program = Effect.gen(function* () {
      yield* TestClock.setTime(fixedNow);
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      yield* confect.run(seedConnection(), Id("providerConnections"));
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          return yield* writer
            .table("providerConnections")
            .insert({
              provider: "nango" as const,
              providerConfigKey: "slack",
              organizationKey: "agency_acme",
              connectionKey: "slack_agency_duplicate_race",
              connectionGeneration: 1,
              status: "active" as const,
              connectSessionId: "maestro-session-duplicate-race",
              nangoConnectionId: "nango-conn-duplicate-race",
              nangoEndUserId: "nango-user-duplicate-race",
              nangoOrganizationId: "nango-org-duplicate-race",
              correlationTag: "slack-connect:maestro-session-duplicate-race",
              attemptId: "attempt_duplicate_race",
              attemptExpiresAt: 2_000,
              completedAt: 1_000,
              teamId: "T_acme",
              apiAppId: "A_acme",
              botUserId: "B_acme",
              createdAt: 1_000,
              updatedAt: 1_000,
            })
            .pipe(Effect.orDie);
        }),
        Id("providerConnections"),
      );

      const committed = yield* confect.mutation(directoryRefs.commitChannels, {
        connectionKey: "slack_agency_acme",
        expectedGeneration: 2,
        providerIdentity: {
          teamId: "T_acme",
          apiAppId: "A_acme",
          botUserId: "B_acme",
        },
        cursor: null,
        limit: 1,
        providerChannels: [
          { id: "C_general", name: "general", is_member: true },
        ],
        providerNextCursor: null,
      });
      expect(committed).toEqual({ kind: "bot_identity_mismatch" });

      const rows = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const raw = reader as unknown as {
            table: (name: string) => {
              index: (
                name: string,
                range: (q: {
                  eq: (
                    field: string,
                    value: unknown,
                  ) => {
                    eq: (field: string, value: unknown) => unknown;
                  };
                }) => unknown,
              ) => { take: (count: number) => Effect.Effect<unknown, unknown> };
            };
          };
          return yield* raw
            .table("channelSyncStates")
            .index("by_access_state", (q) =>
              q
                .eq("connectionKey", "slack_agency_acme")
                .eq("lane", "reconciliation"),
            )
            .take(10)
            .pipe(Effect.orDie);
        }),
        Schema.Any,
      );
      const audit = JSON.parse(JSON.stringify(rows[0]));
      expect(audit).toMatchObject({
        connectionGeneration: 2,
        status: "access_lost",
        replacementAudit: expect.objectContaining({
          connectionKey: "slack_agency_acme",
          connectionGeneration: 2,
          reason: "team_or_app_or_bot_changed",
        }),
      });
      expect(audit.updatedAt).toBe(audit.replacementAudit.recordedAt);
      expect(audit.createdAt).toBe(audit.replacementAudit.recordedAt);
    });
    await Effect.runPromise(
      program.pipe(
        Effect.provide(
          Layer.merge(slackDirectoryTestLayer(), TestContext.TestContext),
        ),
      ),
    );
  });
});
