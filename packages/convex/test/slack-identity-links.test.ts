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
import identityLinksImpl, {
  createSlackIdentityLinkIntentPlan,
  consumeSlackIdentityLinkPlan,
} from "../confect/slack/identityLinks.impl";
import slackIdentityLinks, {
  createSlackIdentityLinkIntent,
  consumeSlackIdentityLink,
  LinkExpired,
  LinkReplay,
  revokeSlackIdentityLink,
  SlackIdentityAlreadyBound,
  TeamMismatch,
} from "../confect/slack/identityLinks.spec";
import providerConnectionsSource from "../confect/tables/providerConnections";
import slackIdentityBindingsSource from "../confect/tables/slackIdentityBindings";

const identityRefs = {
  create: Ref.make("slack/identityLinks", createSlackIdentityLinkIntent),
  consume: Ref.make("slack/identityLinks", consumeSlackIdentityLink),
  revoke: Ref.make("slack/identityLinks", revokeSlackIdentityLink),
};
const slackIdentityBindings = slackIdentityBindingsSource(
  "slackIdentityBindings",
);
const providerConnections = providerConnectionsSource("providerConnections");
const transientDatabaseSchema = DatabaseSchema.make({
  ...databaseSchema.tables,
  slackIdentityBindings,
  providerConnections,
});
const transientConvexSchema = defineSchema({
  ...Object.fromEntries(
    Object.entries(databaseSchema.tables).map(([name, table]) => [
      name,
      table.tableDefinition,
    ]),
  ),
  slackIdentityBindings: slackIdentityBindings.tableDefinition,
  providerConnections: providerConnections.tableDefinition,
});
const registeredFunctions = RegisteredFunctions.buildForGroup<
  typeof slackIdentityLinks
>(transientDatabaseSchema, identityLinksImpl, RegisteredConvexFunction.make);
const testConfectLayer = TestConfect.layer(
  transientDatabaseSchema,
  transientConvexSchema,
  {
    ...import.meta.glob("../convex/**/!(*.*.*)*.*s"),
    "../convex/slack/identityLinks.ts": async () => registeredFunctions,
  },
);

const identity = {
  subject: "member-subject",
  email: "member@example.com",
  emailVerified: true,
  workosOrganizationId: "workos_acme",
};

const activeBinding = {
  bindingKey: "slackbind_agency_acme_T_acme_U_requester",
  organizationKey: "agency_acme",
  connectionKey: "slack_agency_acme",
  connectionGeneration: 2,
  teamId: "T_acme",
  slackUserId: "U_requester",
  userId: "user_123",
  workosSubject: "workos_subject_123",
  status: "active" as const,
  bindingGeneration: 1,
  nonceHash: "sha256:old",
  intentExpiresAt: 1_500,
  createdAt: 1_000,
  updatedAt: 1_100,
  verifiedAt: 1_100,
  revokedAt: null,
  revokeReason: null,
};

const pendingBinding = {
  ...activeBinding,
  status: "pending_verification" as const,
  bindingGeneration: 2,
  nonceHash: "sha256:nonce",
  intentExpiresAt: 2_000,
  verifiedAt: null,
};

describe("Slack identity link contract", () => {
  it("exposes exact binding indexes without email or display-name lookup", () => {
    const table = slackIdentityBindingsSource("slackIdentityBindings");
    const definition = table.tableDefinition as unknown as {
      readonly indexes: readonly {
        readonly indexDescriptor: string;
        readonly fields: readonly string[];
      }[];
    };
    const indexes = Object.fromEntries(
      definition.indexes.map((index) => [
        index.indexDescriptor,
        [...index.fields],
      ]),
    );

    expect(indexes).toEqual({
      by_binding_key: ["bindingKey"],
      by_organization_user_status: ["organizationKey", "userId", "status"],
      by_exact_slack_identity_status: [
        "organizationKey",
        "teamId",
        "slackUserId",
        "status",
      ],
      by_connection_generation_status: [
        "connectionKey",
        "connectionGeneration",
        "status",
      ],
      by_nonce_hash: ["nonceHash"],
    });
    expect(JSON.stringify(table.tableDefinition)).not.toContain("email");
    expect(JSON.stringify(table.tableDefinition)).not.toContain("displayName");
  });

  it("creates a pending single-use nonce-bound intent", () => {
    const intent = createSlackIdentityLinkIntentPlan({
      organizationKey: "agency_acme",
      connectionKey: "slack_agency_acme",
      connectionGeneration: 2,
      teamId: "T_acme",
      userId: "user_123",
      workosSubject: "workos_subject_123",
      nonceHash: "sha256:nonce",
      now: 1_000,
    });

    expect(Either.isRight(intent)).toBe(true);
    if (Either.isRight(intent)) {
      expect(intent.right.row).toMatchObject({
        bindingKey: "slackbind_agency_acme_T_acme_pending_user_123_2",
        status: "pending_verification",
        teamId: "T_acme",
        slackUserId: "pending:user_123:2",
        intentExpiresAt: 1_300,
      });
      expect(intent.right.linkToken).toBe(
        "slack-link:agency_acme:T_acme:sha256:nonce",
      );
      expect(JSON.stringify(intent.right)).not.toContain("workos_subject_123:");
    }
  });

  it("rejects expired, replayed, wrong-team, and already-bound confirmations", () => {
    const expired = consumeSlackIdentityLinkPlan({
      pending: pendingBinding,
      existingActiveForSlackIdentity: null,
      confirmation: { teamId: "T_acme", slackUserId: "U_requester" },
      now: 2_001,
    });
    expect(Either.isLeft(expired) && expired.left instanceof LinkExpired).toBe(
      true,
    );

    const replay = consumeSlackIdentityLinkPlan({
      pending: activeBinding,
      existingActiveForSlackIdentity: null,
      confirmation: { teamId: "T_acme", slackUserId: "U_requester" },
      now: 1_200,
    });
    expect(Either.isLeft(replay) && replay.left instanceof LinkReplay).toBe(
      true,
    );

    const wrongTeam = consumeSlackIdentityLinkPlan({
      pending: pendingBinding,
      existingActiveForSlackIdentity: null,
      confirmation: { teamId: "T_other", slackUserId: "U_requester" },
      now: 1_200,
    });
    expect(
      Either.isLeft(wrongTeam) && wrongTeam.left instanceof TeamMismatch,
    ).toBe(true);

    const alreadyBound = consumeSlackIdentityLinkPlan({
      pending: pendingBinding,
      existingActiveForSlackIdentity: {
        ...activeBinding,
        userId: "user_other",
      },
      confirmation: { teamId: "T_acme", slackUserId: "U_requester" },
      now: 1_200,
    });
    expect(
      Either.isLeft(alreadyBound) &&
        alreadyBound.left instanceof SlackIdentityAlreadyBound,
    ).toBe(true);
  });

  it("activates only exact Slack team and user metadata", () => {
    const result = consumeSlackIdentityLinkPlan({
      pending: pendingBinding,
      existingActiveForSlackIdentity: null,
      confirmation: { teamId: "T_acme", slackUserId: "U_requester" },
      now: 1_200,
    });

    expect(Either.isRight(result)).toBe(true);
    if (Either.isRight(result)) {
      expect(result.right.patch).toEqual({
        bindingKey: "slackbind_agency_acme_T_acme_U_requester",
        slackUserId: "U_requester",
        status: "active",
        verifiedAt: 1_200,
        updatedAt: 1_200,
      });
    }
  });

  it("executes identity link mutations against durable DB rows", async () => {
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
              subject: "member-subject",
              email: "member@example.com",
              displayName: "Member",
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
              slug: "acme",
              status: "active",
              workosOrganizationId: "workos_acme",
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
          yield* writer
            .table("providerConnections")
            .insert({
              provider: "nango",
              providerConfigKey: "slack",
              organizationKey: "agency_acme",
              connectionKey: "slack_agency_acme",
              connectionGeneration: 2,
              status: "active",
              connectSessionId: "cs_done",
              nangoConnectionId: "nango_conn",
              nangoEndUserId: "user_123",
              nangoOrganizationId: "agency_acme",
              correlationTag: "tag",
              attemptId: "attempt",
              attemptExpiresAt: 1_000,
              completedAt: 1_000,
              teamId: "T_acme",
              apiAppId: "A_app",
              botUserId: "B_bot",
              errorReason: null,
              createdAt: 1_000,
              updatedAt: 1_000,
            })
            .pipe(Effect.orDie);
        }),
        Schema.Any,
      );

      const intent = yield* authed.mutation(identityRefs.create, {
        connectionKey: "slack_agency_acme",
        connectionGeneration: 2,
        teamId: "T_acme",
        nonceHash: "sha256:durable",
        now: 1_000,
      });
      expect(intent).toMatchObject({
        status: "pending_verification",
        teamId: "T_acme",
        expiresAt: 1_300,
      });

      const active = yield* authed.mutation(identityRefs.consume, {
        nonceHash: "sha256:durable",
        teamId: "T_acme",
        slackUserId: "U_requester",
        now: 1_100,
      });
      expect(active).toMatchObject({
        bindingKey: "slackbind_agency_acme_T_acme_U_requester",
        status: "active",
        teamId: "T_acme",
        slackUserId: "U_requester",
        bindingGeneration: 2,
      });

      const replay = yield* Effect.either(
        authed.mutation(identityRefs.consume, {
          nonceHash: "sha256:durable",
          teamId: "T_acme",
          slackUserId: "U_requester",
          now: 1_101,
        }),
      );
      expect(Either.isLeft(replay) && replay.left instanceof LinkReplay).toBe(
        true,
      );

      const revoked = yield* authed.mutation(identityRefs.revoke, {
        bindingKey: active.bindingKey,
        reason: "user_request",
        now: 1_200,
      });
      expect(revoked).toEqual({
        bindingKey: active.bindingKey,
        status: "revoked",
        revokedAt: 1_200,
      });

      const stored = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const table = (
            reader as unknown as {
              table: (name: "slackIdentityBindings") => {
                index: (
                  name: "by_binding_key",
                  range: (q: {
                    eq: (field: "bindingKey", value: string) => unknown;
                  }) => unknown,
                ) => { first: () => Effect.Effect<unknown, unknown> };
              };
            }
          ).table("slackIdentityBindings");
          return yield* table
            .index("by_binding_key", (q) =>
              q.eq("bindingKey", active.bindingKey),
            )
            .first()
            .pipe(Effect.orDie);
        }),
        Schema.Any,
      );
      const storedRow = "value" in stored ? stored.value : stored;
      expect(storedRow).toMatchObject({
        bindingKey: active.bindingKey,
        slackUserId: "U_requester",
        status: "revoked",
        revokeReason: "user_request",
        verifiedAt: 1_100,
        revokedAt: 1_200,
      });
    });

    await Effect.runPromise(program.pipe(Effect.provide(testConfectLayer())));
  });
});
