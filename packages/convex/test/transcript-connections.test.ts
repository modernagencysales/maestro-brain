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
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import transcriptConnectionsImpl from "../confect/integrations/transcriptConnections.impl";
import transcriptConnections, {
  authorizeTranscriptConnectCompletion,
  beginTranscriptConnect,
  completeTranscriptConnect,
  finalizeTranscriptConnectAttempt,
  prepareTranscriptConnectAttempt,
} from "../confect/integrations/transcriptConnections.spec";
import providerConnectionsSource from "../confect/tables/providerConnections";

const refs = {
  begin: Ref.make("integrations/transcriptConnections", beginTranscriptConnect),
  complete: Ref.make(
    "integrations/transcriptConnections",
    completeTranscriptConnect,
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
          Effect.gen(function* () {
            return yield* (yield* DatabaseReader)
              .table("providerConnections")
              .index("by_organization", (q) =>
                q.eq("organizationKey", "agency_acme"),
              )
              .take(10)
              .pipe(Effect.orDie);
          }),
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

      yield* authed.action(refs.complete, {
        provider: "fireflies",
        connectSessionId: fireflies.connectSessionId,
        connectionId: "conn_fireflies_1",
      });
      const gong = yield* authed.action(refs.begin, { provider: "gong" });
      expect(gong.connectSessionId).not.toBe(fireflies.connectSessionId);
      expect(yield* rows()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            providerConfigKey: "fireflies",
            status: "verifying",
            nangoConnectionId: "conn_fireflies_1",
          }),
          expect.objectContaining({
            providerConfigKey: "gong-oauth",
            status: "authorizing",
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
  });
});
