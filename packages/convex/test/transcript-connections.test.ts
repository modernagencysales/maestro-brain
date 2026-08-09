import { Ref } from "@confect/core";
import {
  DatabaseSchema,
  RegisteredConvexFunction,
  RegisteredFunctions,
} from "@confect/server";
import { TestConfect } from "@confect/test";
import { defineSchema } from "convex/server";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Either from "effect/Either";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import databaseSchema from "../confect/_generated/schema";
import {
  DatabaseReader,
  DatabaseWriter,
  type Scheduler,
} from "../confect/_generated/services";
import transcriptConnectionsImpl, {
  transcriptConnectionRefs,
} from "../confect/integrations/transcriptConnections.impl";
import {
  scheduleTranscriptConnectExpiry,
  scheduleTranscriptConnectExpirySafely,
} from "../confect/integrations/transcriptConnections.node";
import transcriptConnections, {
  authorizeTranscriptConnectCompletion,
  beginTranscriptConnect,
  completeTranscriptConnect,
  disconnectTranscriptConnection,
  finalizeTranscriptDisconnect,
  finalizeTranscriptConnectAttempt,
  markTranscriptConnectAttemptFailed,
  prepareTranscriptConnectAttempt,
  requestTranscriptPurge,
  revokeTranscriptConnection,
} from "../confect/integrations/transcriptConnections.spec";
import providerConnectionsSource from "../confect/tables/providerConnections";

const refs = {
  begin: Ref.make("integrations/transcriptConnections", beginTranscriptConnect),
  complete: Ref.make(
    "integrations/transcriptConnections",
    completeTranscriptConnect,
  ),
  disconnect: Ref.make(
    "integrations/transcriptConnections",
    disconnectTranscriptConnection,
  ),
  revoke: Ref.make(
    "integrations/transcriptConnections",
    revokeTranscriptConnection,
  ),
  finalizeDisconnect: Ref.make(
    "integrations/transcriptConnections",
    finalizeTranscriptDisconnect,
  ),
  requestPurge: Ref.make(
    "integrations/transcriptConnections",
    requestTranscriptPurge,
  ),
  prepare: Ref.make(
    "integrations/transcriptConnections",
    prepareTranscriptConnectAttempt,
  ),
  authorize: Ref.make(
    "integrations/transcriptConnections",
    authorizeTranscriptConnectCompletion,
  ),
  finalize: Ref.make(
    "integrations/transcriptConnections",
    finalizeTranscriptConnectAttempt,
  ),
  markFailed: Ref.make(
    "integrations/transcriptConnections",
    markTranscriptConnectAttemptFailed,
  ),
};

const providerConnections = providerConnectionsSource("providerConnections");
const transientDatabaseSchema = DatabaseSchema.make({
  ...databaseSchema.tables,
  providerConnections,
});
const transientConvexSchema = defineSchema({
  ...Object.fromEntries(
    Object.entries(databaseSchema.tables).map(([name, table]) => [
      name,
      table.tableDefinition,
    ]),
  ),
  providerConnections: providerConnections.tableDefinition,
});
const registeredFunctions = RegisteredFunctions.buildForGroup<
  typeof transcriptConnections
>(
  transientDatabaseSchema,
  transcriptConnectionsImpl,
  RegisteredConvexFunction.make,
);
const testLayer = TestConfect.layer(
  transientDatabaseSchema,
  transientConvexSchema,
  {
    ...import.meta.glob("../convex/**/!(*.*.*)*.*s"),
    "../convex/integrations/transcriptConnections.ts": async () =>
      registeredFunctions,
  },
);

const identity = {
  subject: "transcript-admin",
  email: "admin@example.com",
  emailVerified: true,
  workosOrganizationId: "workos_acme",
};

describe("transcript connection capability", () => {
  it("schedules a fenced failure transition at attempt expiry", async () => {
    let scheduled: unknown;
    const runAfter = ((delay, ref, args) =>
      Effect.sync(() => {
        scheduled = { delayMs: Duration.toMillis(delay), ref, args };
        return "scheduled";
      })) as Scheduler["runAfter"];

    await Effect.runPromise(
      scheduleTranscriptConnectExpiry(runAfter, {
        connectSessionId: "maestro-session-1",
        expectedConnectionGeneration: 2,
        attemptExpiresAt: 301_000,
        now: 1_000,
      }),
    );

    expect(scheduled).toMatchObject({
      delayMs: 300_000,
      ref: transcriptConnectionRefs.markFailed,
      args: {
        connectSessionId: "maestro-session-1",
        expectedConnectionGeneration: 2,
        now: 301_000,
      },
    });
  });

  it("marks the attempt failed when scheduler enqueue dies", async () => {
    const runAfter = (() =>
      Effect.die("scheduler unavailable")) as Scheduler["runAfter"];
    let markedFailed = false;

    const result = await Effect.runPromise(
      Effect.either(
        scheduleTranscriptConnectExpirySafely(
          runAfter,
          {
            connectSessionId: "maestro-session-1",
            expectedConnectionGeneration: 2,
            attemptExpiresAt: 301_000,
            now: 1_000,
          },
          () =>
            Effect.sync(() => {
              markedFailed = true;
            }),
        ),
      ),
    );

    expect(markedFailed).toBe(true);
    expect(result).toMatchObject({
      _tag: "Left",
      left: { _tag: "ProviderUnavailable" },
    });
  });

  it("allowlists providers and binds completed connections to one organization", async () => {
    const originalMode = process.env.APP_PROVIDER_MODE;
    process.env.APP_PROVIDER_MODE = "fake";

    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      const authed = confect.withIdentity(identity);
      yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          const userId = yield* writer
            .table("users")
            .insert({
              subject: identity.subject,
              email: identity.email,
              displayName: "Transcript admin",
              status: "active",
              createdAt: 1_000,
              updatedAt: 1_000,
            })
            .pipe(Effect.orDie);
          const organizationId = yield* writer
            .table("organizations")
            .insert({
              ownerUserId: userId,
              name: "Acme",
              slug: "acme-transcripts",
              status: "active",
              workosOrganizationId: identity.workosOrganizationId,
              agencyKey: "agency_acme",
              createdAt: 1_000,
              updatedAt: 1_000,
            })
            .pipe(Effect.orDie);
          yield* writer
            .table("workspaces")
            .insert({
              organizationId,
              ownerUserId: userId,
              brainKey: "agency_acme",
              slug: "acme-agency",
              name: "Acme Agency",
              kind: "agency",
              status: "active",
              dataClassification: "confidential",
              createdAt: 1_000,
              updatedAt: 1_000,
            })
            .pipe(Effect.orDie);
          yield* writer
            .table("organizationMembers")
            .insert({
              organizationId,
              userId,
              role: "admin",
              status: "active",
              acceptedAt: 1_000,
              revokedAt: null,
              createdAt: 1_000,
              updatedAt: 1_000,
            })
            .pipe(Effect.orDie);
        }),
      );
      const rows = () =>
        confect.run(
          DatabaseReader.pipe(
            Effect.flatMap((reader) =>
              reader
                .table("providerConnections")
                .index("by_organization", (q) =>
                  q.eq("organizationKey", "agency_acme"),
                )
                .take(10)
                .pipe(Effect.orDie),
            ),
          ),
          Schema.Any,
        );
      const syncRows = () =>
        confect.run(
          DatabaseReader.pipe(
            Effect.flatMap((reader) =>
              reader
                .table("connectorSyncStates")
                .index("by_connection", (q) =>
                  q.eq("connectionKey", "fireflies_agency_acme"),
                )
                .take(10)
                .pipe(Effect.orDie),
            ),
          ),
          Schema.Any,
        );
      const purgeAuditRows = () =>
        confect.run(
          DatabaseReader.pipe(
            Effect.flatMap((reader) =>
              reader
                .table("accessAuditEvents")
                .index("by_subject", (q) =>
                  q
                    .eq("subjectKind", "privilegedAction")
                    .eq(
                      "subjectId",
                      "transcript-purge:fireflies_agency_acme:0",
                    ),
                )
                .take(10)
                .pipe(Effect.orDie),
            ),
          ),
          Schema.Any,
        );

      const unsupported = yield* Effect.either(
        authed.action(refs.begin, {
          provider: "browser-controlled" as never,
        }),
      );
      expect(Either.isLeft(unsupported)).toBe(true);
      expect(yield* rows()).toEqual([]);

      const prepared = yield* authed.mutation(refs.prepare, {
        provider: "granola",
        nonce: "granola0000000000000000000000000",
        attemptExpiresAt: Date.now() + 300_000,
        now: Date.now(),
      });
      expect(prepared.providerConfigKey).toBe("granola");

      const fireflies = yield* authed.action(refs.begin, {
        provider: "fireflies",
      });
      const firefliesRow = (yield* rows()).find(
        (row: unknown) =>
          (row as { providerConfigKey?: string }).providerConfigKey ===
          "fireflies",
      ) as Record<string, unknown> | undefined;
      expect(firefliesRow).toMatchObject({
        organizationKey: "agency_acme",
        providerConfigKey: "fireflies",
        status: "authorizing",
      });
      expect(JSON.stringify(firefliesRow)).not.toContain(
        fireflies.connectSessionToken,
      );

      const authorization = yield* authed.mutation(refs.authorize, {
        provider: "fireflies",
        connectSessionId: fireflies.connectSessionId,
        connectionId: "conn_fireflies_1",
        now: Date.now(),
      });
      const mismatch = yield* Effect.either(
        authed.mutation(refs.finalize, {
          provider: "fireflies",
          connectSessionId: fireflies.connectSessionId,
          connectionId: "conn_fireflies_1",
          expectedConnectionGeneration: authorization.connectionGeneration,
          providerOrganizationKey: "nango-org-other",
          providerEndUserId: authorization.nangoEndUserId,
          providerConfigKey: authorization.providerConfigKey,
          correlationTag: authorization.correlationTag,
          now: Date.now(),
        }),
      );
      expect(Either.isLeft(mismatch)).toBe(true);
      if (Either.isLeft(mismatch))
        expect(mismatch.left).toMatchObject({ _tag: "TenantMismatch" });

      const completed = yield* authed.action(refs.complete, {
        provider: "fireflies",
        connectSessionId: fireflies.connectSessionId,
        connectionId: "conn_fireflies_1",
      });
      const prematurePurge = yield* Effect.either(
        authed.mutation(refs.requestPurge, { provider: "fireflies" }),
      );
      expect(prematurePurge).toMatchObject({
        _tag: "Left",
        left: { _tag: "TranscriptPurgeNotReady" },
      });
      yield* confect.run(
        DatabaseWriter.pipe(
          Effect.flatMap((writer) =>
            writer.table("connectorSyncStates").insert({
              organizationKey: "agency_acme",
              connectionKey: "fireflies_agency_acme",
              connectionGeneration: completed.connectionGeneration,
              provider: "fireflies",
              status: "syncing",
              cursor: "cursor_1",
              leaseId: "lease_1",
              leaseExpiresAt: Date.now() + 60_000,
              nextAttemptAt: Date.now(),
              lastSuccessAt: null,
              callsDiscovered: 1,
              callsIngested: 0,
              duplicateCount: 0,
              failureCount: 0,
              lastErrorTag: null,
              backfillComplete: false,
              createdAt: Date.now(),
              updatedAt: Date.now(),
            }),
          ),
        ),
      );
      const lateFailure = yield* Effect.either(
        authed.mutation(refs.markFailed, {
          connectSessionId: fireflies.connectSessionId,
          expectedConnectionGeneration: completed.connectionGeneration,
          now: Date.now() + 300_000,
        }),
      );
      expect(Either.isLeft(lateFailure)).toBe(true);
      const revoked = yield* authed.mutation(refs.revoke, {
        provider: "fireflies",
        now: Date.now(),
      });
      expect(revoked).toMatchObject({
        connectionKey: "fireflies_agency_acme",
        connectionGeneration: completed.connectionGeneration,
        providerConfigKey: "fireflies",
        nangoConnectionId: "conn_fireflies_1",
      });
      expect(yield* rows()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            providerConfigKey: "fireflies",
            status: "revoked",
            nangoConnectionId: "conn_fireflies_1",
            errorReason: "NangoCleanupPending",
          }),
        ]),
      );
      expect(yield* syncRows()).toEqual([
        expect.objectContaining({
          status: "revoked",
          leaseId: null,
          leaseExpiresAt: null,
        }),
      ]);
      const reconnectWhileCleanupPending = yield* Effect.either(
        authed.action(refs.begin, { provider: "fireflies" }),
      );
      expect(reconnectWhileCleanupPending).toMatchObject({
        _tag: "Left",
        left: { _tag: "ConnectionAlreadyExists" },
      });
      expect(yield* rows()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            providerConfigKey: "fireflies",
            nangoConnectionId: "conn_fireflies_1",
            errorReason: "NangoCleanupPending",
          }),
        ]),
      );
      const disconnected = yield* authed.action(refs.disconnect, {
        provider: "fireflies",
      });
      expect(disconnected).toMatchObject({
        connectionKey: "fireflies_agency_acme",
        status: "revoked",
        connectionGeneration: completed.connectionGeneration,
      });
      yield* authed.action(refs.disconnect, { provider: "fireflies" });
      const purgeRequest = yield* authed.mutation(refs.requestPurge, {
        provider: "fireflies",
      });
      expect(purgeRequest).toEqual({
        requestKey: "transcript-purge:fireflies_agency_acme:0",
        status: "pending_review",
        physicalDeletion: false,
      });
      expect(
        yield* authed.mutation(refs.requestPurge, { provider: "fireflies" }),
      ).toEqual(purgeRequest);
      const purgeAudits = yield* purgeAuditRows();
      expect(purgeAudits).toHaveLength(1);
      expect(JSON.parse(purgeAudits[0].metadataJson)).toEqual({
        connectionGeneration: 0,
        execution: "pending_review",
        outcome: "requested",
        physicalDeletion: false,
        provider: "fireflies",
        requestKind: "transcript_connector_purge",
        retainedEvidence: "revisions,segments,citations,audit",
      });
      const gong = yield* authed.action(refs.begin, { provider: "gong" });
      expect(gong.connectSessionId).not.toBe(fireflies.connectSessionId);
      expect(yield* rows()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            providerConfigKey: "fireflies",
            status: "revoked",
            nangoConnectionId: null,
          }),
          expect.objectContaining({
            providerConfigKey: "gong-oauth",
            status: "authorizing",
          }),
        ]),
      );
      yield* authed.action(refs.begin, { provider: "fireflies" });
      expect(yield* rows()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            providerConfigKey: "fireflies",
            status: "reauthorizing",
            purgeRequestedAt: null,
          }),
        ]),
      );
    });

    try {
      await Effect.runPromise(program.pipe(Effect.provide(testLayer())));
    } finally {
      if (originalMode === undefined) delete process.env.APP_PROVIDER_MODE;
      else process.env.APP_PROVIDER_MODE = originalMode;
    }
  });

  it("declares only typed public and internal connection operations", () => {
    expect(
      transcriptConnections.functions.beginTranscriptConnect,
    ).toMatchObject({ functionVisibility: "public" });
    expect(
      transcriptConnections.functions.finalizeTranscriptConnectAttempt,
    ).toMatchObject({ functionVisibility: "internal" });
    expect(
      transcriptConnections.functions.disconnectTranscriptConnection,
    ).toMatchObject({ functionVisibility: "public" });
    expect(
      transcriptConnections.functions.revokeTranscriptConnection,
    ).toMatchObject({ functionVisibility: "internal" });
    expect(
      transcriptConnections.functions.finalizeTranscriptDisconnect,
    ).toMatchObject({ functionVisibility: "internal" });
    expect(
      transcriptConnections.functions.requestTranscriptPurge,
    ).toMatchObject({ functionVisibility: "public" });
  });
});
