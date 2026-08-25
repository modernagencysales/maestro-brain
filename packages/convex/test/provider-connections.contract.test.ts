import { TestConfect } from "@confect/test";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import { describe, expect, it } from "vitest";

import refs from "../confect/_generated/refs";
import databaseSchema from "../confect/_generated/schema";
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
});
