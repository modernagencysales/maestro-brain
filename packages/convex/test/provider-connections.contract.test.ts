import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import { MemberNotInWorkspace, ValidationFailed } from "../confect/errors";
import { LegacyProviderConnectionRow } from "../confect/tables/providerConnections";
import { SeededTenancy, seedTenancy } from "./support/seedTenancy";
import { testConfectLayer } from "./support/confect";

const now = 1_782_924_800_000;

describe("provider connections Confect contract", () => {
  it("retains staged Nango connection attempts until migration", () => {
    expect(
      Schema.decodeUnknownSync(LegacyProviderConnectionRow)({
        provider: "nango",
        providerConfigKey: "slack",
        organizationKey: "organization_123",
        connectionKey: "slack_organization_123",
        connectionGeneration: 0,
        status: "error",
        connectSessionId: "maestro-session-123",
        nangoConnectionId: null,
        nangoEndUserId: "nango-user-slack-123",
        nangoOrganizationId: "nango-org-slack-123",
        correlationTag: "slack-connect:maestro-session-123",
        attemptId: "attempt_123",
        attemptExpiresAt: 2,
        completedAt: null,
        createdAt: 1,
        updatedAt: 2,
      }),
    ).toMatchObject({ provider: "nango", providerConfigKey: "slack" });
  });

  it("persists a generation-fenced connection lifecycle", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const begun = yield* actor.mutation(
        refs.public.integrations.connections.begin,
        { workspaceId: seeded.workspaceId, provider: "slack" },
      );
      const active = yield* actor.mutation(
        refs.public.integrations.connections.complete,
        {
          workspaceId: seeded.workspaceId,
          provider: "slack",
          generation: begun.generation,
          completion: {
            status: "active",
            connectionRef: "conn_redacted_1",
          },
        },
      );
      const stale = yield* actor
        .mutation(refs.public.integrations.connections.revoke, {
          workspaceId: seeded.workspaceId,
          provider: "slack",
          generation: begun.generation - 1,
        })
        .pipe(Effect.flip);
      const listed = yield* actor.query(
        refs.public.integrations.connections.list,
        { workspaceId: seeded.workspaceId },
      );
      return { begun, active, stale, listed };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.begun).toMatchObject({
      provider: "slack",
      status: "authorizing",
      generation: 1,
    });
    expect(result.active).toMatchObject({
      status: "active",
      connectionRef: "conn_redacted_1",
    });
    expect(result.stale).toBeInstanceOf(ValidationFailed);
    expect(result.listed).toHaveLength(1);
  });

  it("derives authorization from server identity", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      return yield* confect
        .withIdentity({
          subject: "outsider-subject",
          email: "outsider@example.com",
        })
        .mutation(refs.public.integrations.connections.begin, {
          workspaceId: seeded.workspaceId,
          provider: "hubspot",
        })
        .pipe(Effect.flip);
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result).toBeInstanceOf(MemberNotInWorkspace);
  });

  it("allows viewers to inspect connections but reserves manual sync for editors", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          const viewerUserId = yield* writer
            .table("users")
            .insert({
              subject: "viewer-subject",
              email: "viewer@example.com",
              displayName: "Viewer",
              status: "active",
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
          yield* writer
            .table("workspaceMembers")
            .insert({
              workspaceId: seeded.workspaceId,
              userId: viewerUserId,
              role: "viewer",
              status: "active",
              acceptedAt: now,
              revokedAt: null,
              deletedAt: null,
              createdAt: now,
              updatedAt: now,
            })
            .pipe(Effect.orDie);
          return null;
        }),
        Schema.Null,
      );
      const viewer = confect.withIdentity({
        subject: "viewer-subject",
        email: "viewer@example.com",
      });
      const editor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const listed = yield* viewer.query(
        refs.public.integrations.connections.list,
        { workspaceId: seeded.workspaceId },
      );
      const slack = yield* viewer
        .action(refs.public.integrations.connections.syncSlack, {
          workspaceId: seeded.workspaceId,
          channelIds: ["C01"],
        })
        .pipe(Effect.flip);
      const drive = yield* viewer
        .action(refs.public.integrations.connections.syncGoogleDrive, {
          workspaceId: seeded.workspaceId,
          driveId: "drive-1",
          rootFolderIds: ["folder-1"],
        })
        .pipe(Effect.flip);
      const hubspot = yield* viewer
        .action(refs.public.integrations.connections.syncHubSpot, {
          workspaceId: seeded.workspaceId,
          portalId: "portal-1",
        })
        .pipe(Effect.flip);
      const discovery = yield* viewer
        .action(refs.public.integrations.connections.discoverProviderScopes, {
          workspaceId: seeded.workspaceId,
          provider: "slack",
        })
        .pipe(Effect.flip);
      const editorRows = yield* editor.query(
        refs.internal.integrations.connections.connectionsForManualSync,
        { workspaceId: seeded.workspaceId },
      );
      const scheduledConnection = yield* confect.query(
        refs.internal.integrations.connections.connectionForSync,
        { workspaceId: seeded.workspaceId, provider: "slack" },
      );
      return {
        listed,
        slack,
        drive,
        hubspot,
        discovery,
        editorRows,
        scheduledConnection,
      };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.listed).toEqual([]);
    expect(result.slack).toBeInstanceOf(MemberNotInWorkspace);
    expect(result.drive).toBeInstanceOf(MemberNotInWorkspace);
    expect(result.hubspot).toBeInstanceOf(MemberNotInWorkspace);
    expect(result.discovery).toBeInstanceOf(MemberNotInWorkspace);
    expect(result.editorRows).toEqual([]);
    expect(result.scheduledConnection).toBeNull();
  });

  it("persists an approved sync scope for reconciliation and clears it on reauthorization", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const begun = yield* actor.mutation(
        refs.public.integrations.connections.begin,
        { workspaceId: seeded.workspaceId, provider: "slack" },
      );
      yield* actor.mutation(refs.public.integrations.connections.complete, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        generation: begun.generation,
        completion: {
          status: "active",
          connectionRef: "conn_redacted_1",
        },
      });
      yield* confect.mutation(
        refs.internal.integrations.connections.recordSlackSync,
        {
          workspaceId: seeded.workspaceId,
          connectionGeneration: begun.generation,
          syncAttemptKey: "slack-attempt-1",
          status: "syncing",
          channelIds: ["C02", "C01", "C02"],
          lookbackDays: 30,
        },
      );
      yield* confect.mutation(
        refs.internal.integrations.connections.recordSlackSync,
        {
          workspaceId: seeded.workspaceId,
          connectionGeneration: begun.generation,
          syncAttemptKey: "slack-attempt-1",
          status: "syncing",
          evidenceScopeKey: "slack:conn_redacted_1:channel:C01:lookback:30",
        },
      );
      const staging = yield* actor.query(
        refs.public.integrations.connections.list,
        { workspaceId: seeded.workspaceId },
      );
      const omittedScopeError = yield* confect
        .mutation(refs.internal.integrations.connections.recordSlackSync, {
          workspaceId: seeded.workspaceId,
          connectionGeneration: begun.generation,
          syncAttemptKey: "slack-attempt-1",
          status: "error",
          errorCode: "slack_sync_failed",
        })
        .pipe(Effect.flip);
      const staleScopeError = yield* confect
        .mutation(refs.internal.integrations.connections.recordSlackSync, {
          workspaceId: seeded.workspaceId,
          connectionGeneration: begun.generation,
          syncAttemptKey: "slack-attempt-1",
          status: "error",
          evidenceScopeKey: "slack:conn_redacted_1:channel:C02:lookback:30",
          errorCode: "slack_sync_failed",
        })
        .pipe(Effect.flip);
      const afterRejectedErrors = yield* actor.query(
        refs.public.integrations.connections.list,
        { workspaceId: seeded.workspaceId },
      );
      yield* confect.mutation(
        refs.internal.integrations.connections.recordSlackSync,
        {
          workspaceId: seeded.workspaceId,
          connectionGeneration: begun.generation,
          syncAttemptKey: "slack-attempt-1",
          status: "ready",
          syncedAt: now,
          messageCount: 2,
          pageCount: 1,
          evidenceScopeKey: "slack:conn_redacted_1:channel:C01:lookback:30",
        },
      );
      const configured = yield* actor.query(
        refs.public.integrations.connections.list,
        { workspaceId: seeded.workspaceId },
      );
      const dispatch = yield* confect.mutation(
        refs.internal.integrations.connections.dispatchScheduledSyncs,
        {},
      );
      const reauthorizing = yield* actor.mutation(
        refs.public.integrations.connections.begin,
        { workspaceId: seeded.workspaceId, provider: "slack" },
      );
      return {
        staging: staging[0],
        omittedScopeError,
        staleScopeError,
        afterRejectedErrors: afterRejectedErrors[0],
        configured: configured[0],
        dispatch,
        reauthorizing,
      };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );

    expect(result.staging).toMatchObject({
      scheduledSyncEnabled: false,
      slackChannelIds: ["C01", "C02"],
      slackLookbackDays: 30,
      evidenceScopeKey: "slack:conn_redacted_1",
      pendingEvidenceScopeKey: "slack:conn_redacted_1:channel:C01:lookback:30",
    });
    expect(result.omittedScopeError).toBeInstanceOf(ValidationFailed);
    expect(result.staleScopeError).toBeInstanceOf(ValidationFailed);
    expect(result.afterRejectedErrors).toMatchObject({
      syncStatus: "syncing",
      pendingEvidenceScopeKey: "slack:conn_redacted_1:channel:C01:lookback:30",
    });
    expect(result.configured).toMatchObject({
      scheduledSyncEnabled: false,
      slackChannelIds: ["C01", "C02"],
      slackLookbackDays: 30,
      evidenceScopeKey: "slack:conn_redacted_1:channel:C01:lookback:30",
    });
    expect(result.configured).not.toHaveProperty("pendingEvidenceScopeKey");
    expect(result.dispatch).toEqual({ scheduledCount: 0, skippedCount: 1 });
    expect(result.reauthorizing).not.toHaveProperty("scheduledSyncEnabled");
    expect(result.reauthorizing).not.toHaveProperty("slackChannelIds");
    expect(result.reauthorizing).not.toHaveProperty("slackLookbackDays");
    expect(result.reauthorizing).not.toHaveProperty("evidenceScopeKey");
    expect(result.reauthorizing).not.toHaveProperty("pendingEvidenceScopeKey");
  });

  it("rejects stale Slack, Drive, and HubSpot sync finalizers after reauthorization", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });

      const slack = yield* actor.mutation(
        refs.public.integrations.connections.begin,
        { workspaceId: seeded.workspaceId, provider: "slack" },
      );
      yield* actor.mutation(refs.public.integrations.connections.complete, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        generation: slack.generation,
        completion: { status: "active", connectionRef: "slack-old" },
      });
      yield* confect.mutation(
        refs.internal.integrations.connections.recordSlackSync,
        {
          workspaceId: seeded.workspaceId,
          connectionGeneration: slack.generation,
          syncAttemptKey: "slack-stale-attempt",
          status: "syncing",
        },
      );
      yield* confect.mutation(
        refs.internal.integrations.connections.recordSlackSync,
        {
          workspaceId: seeded.workspaceId,
          connectionGeneration: slack.generation,
          syncAttemptKey: "slack-stale-attempt",
          status: "syncing",
          evidenceScopeKey: "slack:old:channel:C1:lookback:30",
        },
      );
      yield* actor.mutation(refs.public.integrations.connections.begin, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
      });
      const staleSlack = yield* confect
        .mutation(refs.internal.integrations.connections.recordSlackSync, {
          workspaceId: seeded.workspaceId,
          connectionGeneration: slack.generation,
          syncAttemptKey: "slack-stale-attempt",
          status: "ready",
          evidenceScopeKey: "slack:old:channel:C1:lookback:30",
        })
        .pipe(Effect.flip);

      const drive = yield* actor.mutation(
        refs.public.integrations.connections.begin,
        { workspaceId: seeded.workspaceId, provider: "google-drive" },
      );
      yield* actor.mutation(refs.public.integrations.connections.complete, {
        workspaceId: seeded.workspaceId,
        provider: "google-drive",
        generation: drive.generation,
        completion: { status: "active", connectionRef: "drive-old" },
      });
      yield* confect.mutation(
        refs.internal.integrations.connections.recordProviderSync,
        {
          workspaceId: seeded.workspaceId,
          provider: "google-drive",
          connectionGeneration: drive.generation,
          syncAttemptKey: "drive-stale-attempt",
          status: "syncing",
        },
      );
      yield* confect.mutation(
        refs.internal.integrations.connections.recordProviderSync,
        {
          workspaceId: seeded.workspaceId,
          provider: "google-drive",
          connectionGeneration: drive.generation,
          syncAttemptKey: "drive-stale-attempt",
          status: "syncing",
          evidenceScopeKey: "gds_old",
        },
      );
      yield* actor.mutation(refs.public.integrations.connections.begin, {
        workspaceId: seeded.workspaceId,
        provider: "google-drive",
      });
      const staleDrive = yield* confect
        .mutation(refs.internal.integrations.connections.recordProviderSync, {
          workspaceId: seeded.workspaceId,
          provider: "google-drive",
          connectionGeneration: drive.generation,
          syncAttemptKey: "drive-stale-attempt",
          status: "ready",
          evidenceScopeKey: "gds_old",
        })
        .pipe(Effect.flip);

      const hubspot = yield* actor.mutation(
        refs.public.integrations.connections.begin,
        { workspaceId: seeded.workspaceId, provider: "hubspot" },
      );
      yield* actor.mutation(refs.public.integrations.connections.complete, {
        workspaceId: seeded.workspaceId,
        provider: "hubspot",
        generation: hubspot.generation,
        completion: { status: "active", connectionRef: "hubspot-old" },
      });
      yield* confect.mutation(
        refs.internal.integrations.connections.recordProviderSync,
        {
          workspaceId: seeded.workspaceId,
          provider: "hubspot",
          connectionGeneration: hubspot.generation,
          syncAttemptKey: "hubspot-stale-attempt",
          status: "syncing",
        },
      );
      yield* confect.mutation(
        refs.internal.integrations.connections.recordProviderSync,
        {
          workspaceId: seeded.workspaceId,
          provider: "hubspot",
          connectionGeneration: hubspot.generation,
          syncAttemptKey: "hubspot-stale-attempt",
          status: "syncing",
          evidenceScopeKey: "hss_old",
        },
      );
      yield* actor.mutation(refs.public.integrations.connections.begin, {
        workspaceId: seeded.workspaceId,
        provider: "hubspot",
      });
      const staleHubSpot = yield* confect
        .mutation(refs.internal.integrations.connections.recordProviderSync, {
          workspaceId: seeded.workspaceId,
          provider: "hubspot",
          connectionGeneration: hubspot.generation,
          syncAttemptKey: "hubspot-stale-attempt",
          status: "error",
          evidenceScopeKey: "hss_old",
        })
        .pipe(Effect.flip);
      const rows = yield* actor.query(
        refs.public.integrations.connections.list,
        { workspaceId: seeded.workspaceId },
      );
      return { staleSlack, staleDrive, staleHubSpot, rows };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.staleSlack).toBeInstanceOf(ValidationFailed);
    expect(result.staleDrive).toBeInstanceOf(ValidationFailed);
    expect(result.staleHubSpot).toBeInstanceOf(ValidationFailed);
    for (const row of result.rows) {
      expect(row).not.toHaveProperty("evidenceScopeKey");
      expect(row).not.toHaveProperty("pendingEvidenceScopeKey");
    }
  });

  it("preserves a pending provider scope unless an error matches the same attempt", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const results = [];

      for (const provider of ["google-drive", "hubspot"] as const) {
        const begun = yield* actor.mutation(
          refs.public.integrations.connections.begin,
          { workspaceId: seeded.workspaceId, provider },
        );
        yield* actor.mutation(refs.public.integrations.connections.complete, {
          workspaceId: seeded.workspaceId,
          provider,
          generation: begun.generation,
          completion: {
            status: "active",
            connectionRef: `${provider}-connection`,
          },
        });
        const scopeA = `${provider}-scope-a`;
        const scopeB = `${provider}-scope-b`;
        const attemptKey = `${provider}-attempt-a`;
        yield* confect.mutation(
          refs.internal.integrations.connections.recordProviderSync,
          {
            workspaceId: seeded.workspaceId,
            provider,
            connectionGeneration: begun.generation,
            syncAttemptKey: attemptKey,
            status: "syncing",
          },
        );
        const preScopeError = yield* confect.mutation(
          refs.internal.integrations.connections.recordProviderSync,
          {
            workspaceId: seeded.workspaceId,
            provider,
            connectionGeneration: begun.generation,
            syncAttemptKey: attemptKey,
            status: "error",
            errorCode: "pre_scope_sync_failed",
          },
        );
        yield* confect.mutation(
          refs.internal.integrations.connections.recordProviderSync,
          {
            workspaceId: seeded.workspaceId,
            provider,
            connectionGeneration: begun.generation,
            syncAttemptKey: attemptKey,
            status: "syncing",
          },
        );
        yield* confect.mutation(
          refs.internal.integrations.connections.recordProviderSync,
          {
            workspaceId: seeded.workspaceId,
            provider,
            connectionGeneration: begun.generation,
            syncAttemptKey: attemptKey,
            status: "syncing",
            evidenceScopeKey: scopeA,
          },
        );
        const omittedScopeError = yield* confect
          .mutation(refs.internal.integrations.connections.recordProviderSync, {
            workspaceId: seeded.workspaceId,
            provider,
            connectionGeneration: begun.generation,
            syncAttemptKey: attemptKey,
            status: "error",
            errorCode: "sync_failed",
          })
          .pipe(Effect.flip);
        const afterOmittedScope = (yield* actor.query(
          refs.public.integrations.connections.list,
          {
            workspaceId: seeded.workspaceId,
          },
        )).find((row) => row.provider === provider);
        const staleScopeError = yield* confect
          .mutation(refs.internal.integrations.connections.recordProviderSync, {
            workspaceId: seeded.workspaceId,
            provider,
            connectionGeneration: begun.generation,
            syncAttemptKey: attemptKey,
            status: "error",
            evidenceScopeKey: scopeB,
            errorCode: "sync_failed",
          })
          .pipe(Effect.flip);
        const afterStaleScope = (yield* actor.query(
          refs.public.integrations.connections.list,
          {
            workspaceId: seeded.workspaceId,
          },
        )).find((row) => row.provider === provider);
        const matchingScopeError = yield* confect.mutation(
          refs.internal.integrations.connections.recordProviderSync,
          {
            workspaceId: seeded.workspaceId,
            provider,
            connectionGeneration: begun.generation,
            syncAttemptKey: attemptKey,
            status: "error",
            evidenceScopeKey: scopeA,
            errorCode: "sync_failed",
          },
        );
        results.push({
          provider,
          scopeA,
          preScopeError,
          omittedScopeError,
          afterOmittedScope,
          staleScopeError,
          afterStaleScope,
          matchingScopeError,
        });
      }
      return results;
    });

    const results = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    for (const result of results) {
      expect(result.preScopeError).toMatchObject({
        provider: result.provider,
        syncStatus: "error",
        syncErrorCode: "pre_scope_sync_failed",
      });
      expect(result.omittedScopeError).toBeInstanceOf(ValidationFailed);
      expect(result.afterOmittedScope).toMatchObject({
        syncStatus: "syncing",
        pendingEvidenceScopeKey: result.scopeA,
      });
      expect(result.afterOmittedScope).not.toHaveProperty("evidenceScopeKey");
      expect(result.staleScopeError).toBeInstanceOf(ValidationFailed);
      expect(result.afterStaleScope).toMatchObject({
        syncStatus: "syncing",
        pendingEvidenceScopeKey: result.scopeA,
      });
      expect(result.afterStaleScope).not.toHaveProperty("evidenceScopeKey");
      expect(result.matchingScopeError).toMatchObject({
        provider: result.provider,
        syncStatus: "error",
        syncErrorCode: "sync_failed",
      });
      expect(result.matchingScopeError).not.toHaveProperty(
        "pendingEvidenceScopeKey",
      );
      expect(result.matchingScopeError).not.toHaveProperty("evidenceScopeKey");
    }
  });

  it("rejects a stale Slack finalizer when a newer attempt uses the same scope", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const begun = yield* actor.mutation(
        refs.public.integrations.connections.begin,
        { workspaceId: seeded.workspaceId, provider: "slack" },
      );
      yield* actor.mutation(refs.public.integrations.connections.complete, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        generation: begun.generation,
        completion: { status: "active", connectionRef: "slack-race" },
      });
      const scopeKey = "slack:slack-race:channel:C1:lookback:30";
      for (const syncAttemptKey of ["attempt-a", "attempt-b"]) {
        yield* confect.mutation(
          refs.internal.integrations.connections.recordSlackSync,
          {
            workspaceId: seeded.workspaceId,
            connectionGeneration: begun.generation,
            syncAttemptKey,
            status: "syncing",
          },
        );
        yield* confect.mutation(
          refs.internal.integrations.connections.recordSlackSync,
          {
            workspaceId: seeded.workspaceId,
            connectionGeneration: begun.generation,
            syncAttemptKey,
            status: "syncing",
            evidenceScopeKey: scopeKey,
          },
        );
      }
      const stale = yield* confect
        .mutation(refs.internal.integrations.connections.recordSlackSync, {
          workspaceId: seeded.workspaceId,
          connectionGeneration: begun.generation,
          syncAttemptKey: "attempt-a",
          status: "ready",
          evidenceScopeKey: scopeKey,
        })
        .pipe(Effect.flip);
      const ready = yield* confect.mutation(
        refs.internal.integrations.connections.recordSlackSync,
        {
          workspaceId: seeded.workspaceId,
          connectionGeneration: begun.generation,
          syncAttemptKey: "attempt-b",
          status: "ready",
          evidenceScopeKey: scopeKey,
        },
      );
      return { stale, ready };
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result.stale).toBeInstanceOf(ValidationFailed);
    expect(result.ready).toMatchObject({
      syncStatus: "ready",
      evidenceScopeKey: "slack:slack-race:channel:C1:lookback:30",
    });
    expect(result.ready).not.toHaveProperty("pendingSyncAttemptKey");
  });

  it("rejects scheduled Drive and HubSpot jobs from an older authorization generation", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const failures = [];
      for (const provider of ["google-drive", "hubspot"] as const) {
        const first = yield* actor.mutation(
          refs.public.integrations.connections.begin,
          { workspaceId: seeded.workspaceId, provider },
        );
        yield* actor.mutation(refs.public.integrations.connections.complete, {
          workspaceId: seeded.workspaceId,
          provider,
          generation: first.generation,
          completion: { status: "active", connectionRef: `${provider}-old` },
        });
        const second = yield* actor.mutation(
          refs.public.integrations.connections.begin,
          { workspaceId: seeded.workspaceId, provider },
        );
        yield* actor.mutation(refs.public.integrations.connections.complete, {
          workspaceId: seeded.workspaceId,
          provider,
          generation: second.generation,
          completion: { status: "active", connectionRef: `${provider}-new` },
        });
        const failure =
          provider === "google-drive"
            ? yield* confect
                .action(
                  refs.internal.integrations.connections
                    .syncGoogleDriveScheduled,
                  {
                    workspaceId: seeded.workspaceId,
                    driveId: "drive-1",
                    rootFolderIds: ["folder-1"],
                    expectedConnectionGeneration: first.generation,
                  },
                )
                .pipe(Effect.flip)
            : yield* confect
                .action(
                  refs.internal.integrations.connections.syncHubSpotScheduled,
                  {
                    workspaceId: seeded.workspaceId,
                    portalId: "portal-1",
                    expectedConnectionGeneration: first.generation,
                  },
                )
                .pipe(Effect.flip);
        failures.push(failure);
      }
      return failures;
    });

    const failures = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(failures).toHaveLength(2);
    for (const failure of failures) {
      expect(failure).toBeInstanceOf(ValidationFailed);
      expect(failure).toMatchObject({ field: "generation" });
    }
  });

  it("fails an active Slack evidence run when its connection is revoked", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });
      const begun = yield* actor.mutation(
        refs.public.integrations.connections.begin,
        { workspaceId: seeded.workspaceId, provider: "slack" },
      );
      yield* actor.mutation(refs.public.integrations.connections.complete, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        generation: begun.generation,
        completion: {
          status: "active",
          connectionRef: "conn_redacted_1",
        },
      });
      yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        scopeKey: "slack:conn_redacted_1",
        runKey: "slack:1:run",
        startedAt: now,
      });
      yield* actor.mutation(refs.public.integrations.connections.revoke, {
        workspaceId: seeded.workspaceId,
        provider: "slack",
        generation: begun.generation,
      });
      return yield* confect.run(
        Effect.gen(function* () {
          const runs = yield* (yield* DatabaseReader)
            .table("brainConnectorRuns")
            .index("by_workspace_and_run_key", (q) =>
              q
                .eq("workspaceId", seeded.workspaceId)
                .eq("runKey", "slack:1:run"),
            )
            .take(1)
            .pipe(Effect.orDie);
          const run = runs[0];
          return run === undefined
            ? null
            : {
                runKey: run.runKey,
                status: run.status,
                failureCode: run.failureCode,
              };
        }),
        Schema.NullOr(
          Schema.Struct({
            runKey: Schema.String,
            status: Schema.String,
            failureCode: Schema.optional(Schema.String),
          }),
        ),
      );
    });

    const result = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(result).toMatchObject({
      runKey: "slack:1:run",
      status: "failed",
      failureCode: "connection_revoked",
    });
  });

  it("fails pending runs on reauthorization and active runs on revoke for every connector", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* TestConfect.TestConfect<typeof databaseSchema>();
      const seeded = yield* confect.run(seedTenancy(now), SeededTenancy);
      const actor = confect.withIdentity({
        subject: "member-subject",
        email: "member@example.com",
      });

      for (const provider of ["slack", "google-drive", "hubspot"] as const) {
        const evidenceProvider =
          provider === "google-drive" ? "google_drive" : provider;
        const first = yield* actor.mutation(
          refs.public.integrations.connections.begin,
          { workspaceId: seeded.workspaceId, provider },
        );
        yield* actor.mutation(refs.public.integrations.connections.complete, {
          workspaceId: seeded.workspaceId,
          provider,
          generation: first.generation,
          completion: { status: "active", connectionRef: `${provider}-one` },
        });
        const pendingScope = `${evidenceProvider}:pending`;
        const pendingAttempt = `${provider}:pending-attempt`;
        if (provider === "slack") {
          yield* confect.mutation(
            refs.internal.integrations.connections.recordSlackSync,
            {
              workspaceId: seeded.workspaceId,
              connectionGeneration: first.generation,
              syncAttemptKey: pendingAttempt,
              status: "syncing",
            },
          );
          yield* confect.mutation(
            refs.internal.integrations.connections.recordSlackSync,
            {
              workspaceId: seeded.workspaceId,
              connectionGeneration: first.generation,
              syncAttemptKey: pendingAttempt,
              status: "syncing",
              evidenceScopeKey: pendingScope,
            },
          );
        } else {
          yield* confect.mutation(
            refs.internal.integrations.connections.recordProviderSync,
            {
              workspaceId: seeded.workspaceId,
              provider,
              connectionGeneration: first.generation,
              syncAttemptKey: pendingAttempt,
              status: "syncing",
            },
          );
          yield* confect.mutation(
            refs.internal.integrations.connections.recordProviderSync,
            {
              workspaceId: seeded.workspaceId,
              provider,
              connectionGeneration: first.generation,
              syncAttemptKey: pendingAttempt,
              status: "syncing",
              evidenceScopeKey: pendingScope,
            },
          );
        }
        yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
          workspaceId: seeded.workspaceId,
          provider: evidenceProvider,
          scopeKey: pendingScope,
          connectionGeneration: first.generation,
          runKey: `${provider}:pending-run`,
          startedAt: now,
        });
        const second = yield* actor.mutation(
          refs.public.integrations.connections.begin,
          { workspaceId: seeded.workspaceId, provider },
        );
        yield* actor.mutation(refs.public.integrations.connections.complete, {
          workspaceId: seeded.workspaceId,
          provider,
          generation: second.generation,
          completion: { status: "active", connectionRef: `${provider}-two` },
        });

        const activeScope = `${evidenceProvider}:active`;
        const activeAttempt = `${provider}:active-attempt`;
        if (provider === "slack") {
          for (const evidenceScopeKey of [undefined, activeScope])
            yield* confect.mutation(
              refs.internal.integrations.connections.recordSlackSync,
              {
                workspaceId: seeded.workspaceId,
                connectionGeneration: second.generation,
                syncAttemptKey: activeAttempt,
                status: "syncing",
                ...(evidenceScopeKey === undefined ? {} : { evidenceScopeKey }),
              },
            );
          yield* confect.mutation(
            refs.internal.integrations.connections.recordSlackSync,
            {
              workspaceId: seeded.workspaceId,
              connectionGeneration: second.generation,
              syncAttemptKey: activeAttempt,
              status: "ready",
              evidenceScopeKey: activeScope,
            },
          );
        } else {
          for (const evidenceScopeKey of [undefined, activeScope])
            yield* confect.mutation(
              refs.internal.integrations.connections.recordProviderSync,
              {
                workspaceId: seeded.workspaceId,
                provider,
                connectionGeneration: second.generation,
                syncAttemptKey: activeAttempt,
                status: "syncing",
                ...(evidenceScopeKey === undefined ? {} : { evidenceScopeKey }),
              },
            );
          yield* confect.mutation(
            refs.internal.integrations.connections.recordProviderSync,
            {
              workspaceId: seeded.workspaceId,
              provider,
              connectionGeneration: second.generation,
              syncAttemptKey: activeAttempt,
              status: "ready",
              evidenceScopeKey: activeScope,
            },
          );
        }
        yield* confect.mutation(refs.internal.brain.evidence.beginRun, {
          workspaceId: seeded.workspaceId,
          provider: evidenceProvider,
          scopeKey: activeScope,
          connectionGeneration: second.generation,
          runKey: `${provider}:active-run`,
          startedAt: now + 1,
        });
        yield* actor.mutation(refs.public.integrations.connections.revoke, {
          workspaceId: seeded.workspaceId,
          provider,
          generation: second.generation,
        });
      }

      return yield* confect.run(
        Effect.gen(function* () {
          const runs = yield* (yield* DatabaseReader)
            .table("brainConnectorRuns")
            .index("by_workspace_and_provider_and_updated_at", (q) =>
              q.eq("workspaceId", seeded.workspaceId),
            )
            .take(10)
            .pipe(Effect.orDie);
          return runs.map(({ status, failureCode }) => ({
            status,
            failureCode,
          }));
        }),
        Schema.mutable(
          Schema.Array(
            Schema.Struct({
              status: Schema.String,
              failureCode: Schema.optional(Schema.String),
            }),
          ),
        ),
      );
    });

    const runs = await Effect.runPromise(
      program.pipe(Effect.provide(testConfectLayer())),
    );
    expect(runs).toHaveLength(6);
    for (const run of runs) {
      expect(run).toMatchObject({ status: "failed" });
      expect(["connection_reauthorized", "connection_revoked"]).toContain(
        run.failureCode,
      );
    }
  });
});
