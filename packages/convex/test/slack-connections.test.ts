import { readFileSync } from "node:fs";
import * as Either from "effect/Either";
import { describe, expect, it } from "vitest";

import { Ref } from "@confect/core";
import {
  DatabaseSchema,
  RegisteredConvexFunction,
  RegisteredFunctions,
} from "@confect/server";
import { TestConfect } from "@confect/test";
import { defineSchema } from "convex/server";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

import { Id } from "../confect/_generated/id";
import databaseSchema from "../confect/_generated/schema";
import { DatabaseReader, DatabaseWriter } from "../confect/_generated/services";
import slackConnectionsImpl from "../confect/integrations/slackConnections.impl";
import slackConnections, {
  authorizeSlackConnectCompletion,
  beginSlackConnect,
  claimSlackConnectAttempt,
  completeSlackConnect,
  ConnectionAlreadyExists,
  finalizeSlackConnectAttempt,
  markSlackConnectAttemptFailed,
  prepareSlackConnectAttempt,
  reconcileSlackConnectSessionExpiry,
  TenantMismatch,
} from "../confect/integrations/slackConnections.spec";
import {
  authorizeSlackConnectCompletionPlan,
  beginSlackConnectPlan,
  completeSlackConnectPlan,
  finalizeSlackConnectAttemptPlan,
  makeSlackConnectAttemptIds,
  reconcileSlackConnectSessionExpiryPlan,
  reserveSlackConnectAttemptPlan,
  selectCurrentSlackOrganization,
  slackConnectAttemptGenerationFor,
  slackConnectAttemptStatusFor,
  validateOpaqueSlackConnectIds,
  type ProviderConnectionRow as ProviderConnectionRowValue,
  type SlackConnectionState,
} from "../confect/integrations/slackConnections.impl";
import providerConnectionsSource, {
  ProviderConnectionRow,
} from "../confect/tables/providerConnections";

type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
type Assert<T extends true> = T;
type Not<T extends boolean> = T extends true ? false : true;
const authorizeRef = Ref.make(
  "integrations/slackConnections",
  authorizeSlackConnectCompletion,
);
const finalizeRef = Ref.make(
  "integrations/slackConnections",
  finalizeSlackConnectAttempt,
);
type AuthorizeArgs = Ref.Args<typeof authorizeRef>;
type FinalizeArgs = Ref.Args<typeof finalizeRef>;
export type AuthorizeArgsRequireConnectionId = Assert<
  Equal<
    AuthorizeArgs,
    {
      readonly connectSessionId: string;
      readonly connectionId: string;
      readonly now: number;
    }
  >
>;
export type AuthorizeAndFinalizeArgsDiffer = Assert<
  Not<Equal<AuthorizeArgs, FinalizeArgs>>
>;

const slackRefs = {
  begin: Ref.make("integrations/slackConnections", beginSlackConnect),
  complete: Ref.make("integrations/slackConnections", completeSlackConnect),
  prepare: Ref.make(
    "integrations/slackConnections",
    prepareSlackConnectAttempt,
  ),
  reconcileExpiry: Ref.make(
    "integrations/slackConnections",
    reconcileSlackConnectSessionExpiry,
  ),
  markFailed: Ref.make(
    "integrations/slackConnections",
    markSlackConnectAttemptFailed,
  ),
  authorize: authorizeRef,
  claim: Ref.make("integrations/slackConnections", claimSlackConnectAttempt),
  finalize: finalizeRef,
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
const slackRegisteredFunctions = RegisteredFunctions.buildForGroup<
  typeof slackConnections
>(transientDatabaseSchema, slackConnectionsImpl, RegisteredConvexFunction.make);
const slackTestConfectLayer = TestConfect.layer(
  transientDatabaseSchema,
  transientConvexSchema,
  {
    ...import.meta.glob("../convex/**/!(*.*.*)*.*s"),
    "../convex/integrations/slackConnections.ts": async () =>
      slackRegisteredFunctions,
  },
);

const identity = {
  subject: "member-subject",
  email: "member@example.com",
  emailVerified: true,
  workosOrganizationId: "workos_acme",
};

describe("Slack connection capability contract", () => {
  it("declares begin and complete Slack connect functions with typed errors", () => {
    const spec = JSON.stringify(slackConnections);

    expect(spec).toContain("beginSlackConnect");
    expect(spec).toContain("completeSlackConnect");
    expect(slackConnections.functions.beginSlackConnect).toMatchObject({
      functionVisibility: "public",
      name: "beginSlackConnect",
    });
    expect(slackConnections.functions.completeSlackConnect).toMatchObject({
      functionVisibility: "public",
      name: "completeSlackConnect",
    });
    expect(slackConnections.functions.prepareSlackConnectAttempt).toMatchObject(
      {
        functionVisibility: "internal",
        name: "prepareSlackConnectAttempt",
      },
    );
    expect(
      slackConnections.functions.markSlackConnectAttemptFailed,
    ).toMatchObject({
      functionVisibility: "internal",
      name: "markSlackConnectAttemptFailed",
    });
    expect(
      new ConnectionAlreadyExists({ organizationKey: "org_acme" }),
    ).toMatchObject({
      _tag: "ConnectionAlreadyExists",
    });
    expect(new TenantMismatch()).toMatchObject({ _tag: "TenantMismatch" });
  });

  it("keeps public actions behind the injected Nango provider service", () => {
    const source = readFileSync(
      new URL(
        "../confect/integrations/slackConnections.impl.ts",
        import.meta.url,
      ),
      "utf8",
    );

    expect(source).not.toContain("NangoProviderFake");
    expect(source).not.toContain("createFakeNangoClient");
    expect(source).not.toContain("Effect.provide(NangoProvider");
    expect(source).toContain("NangoProvider");
  });

  it("executes Slack connect mutations against durable DB rows", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      const authed = confect.withIdentity(identity);
      const seeded = yield* confect.run(
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
          const memberId = yield* writer
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
          return { organizationId, memberId };
        }),
        Schema.Struct({
          organizationId: Id("organizations"),
          memberId: Id("organizationMembers"),
        }),
      );

      const first = yield* authed.mutation(slackRefs.prepare, {
        now: 1_000,
        attemptExpiresAt: 1_300,
        nonce: "firstopaque0000000000000000",
      });
      const afterPrepare = yield* confect.run(
        Effect.gen(function* () {
          const reader = yield* DatabaseReader;
          const row = yield* (
            reader as unknown as {
              table: (name: "providerConnections") => {
                index: (
                  name: "by_connect_session",
                  range: (q: {
                    eq: (field: string, value: string) => unknown;
                  }) => unknown,
                ) => { first: () => Effect.Effect<unknown, unknown> };
              };
            }
          )
            .table("providerConnections")
            .index("by_connect_session", (q) =>
              q.eq("connectSessionId", first.connectSessionId),
            )
            .first()
            .pipe(Effect.orDie);
          return row;
        }),
        Schema.Any,
      );
      const preparedRow =
        "value" in afterPrepare ? afterPrepare.value : afterPrepare;
      expect(preparedRow).toMatchObject({
        status: "authorizing",
        connectionGeneration: 0,
        attemptExpiresAt: 1_300,
        nangoOrganizationId: first.nangoOrganizationId,
      });
      expect(JSON.stringify(preparedRow)).not.toContain("connect_public_");

      const staleExpiry = yield* Effect.either(
        authed.mutation(slackRefs.reconcileExpiry, {
          connectSessionId: first.connectSessionId,
          attemptId: "attempt_stale",
          expectedConnectionGeneration: first.connectionGeneration,
          providerExpiresAt: 1_200,
          localMaxExpiresAt: 1_300,
          now: 1_000,
        }),
      );
      expect(Either.isLeft(staleExpiry)).toBe(true);
      if (Either.isLeft(staleExpiry)) {
        expect(staleExpiry.left).toMatchObject({
          _tag: "ConnectSessionInvalid",
        });
      }
      yield* authed.mutation(slackRefs.reconcileExpiry, {
        connectSessionId: first.connectSessionId,
        attemptId: first.attemptId,
        expectedConnectionGeneration: first.connectionGeneration,
        providerExpiresAt: 1_200,
        localMaxExpiresAt: 1_300,
        now: 1_000,
      });
      yield* authed.mutation(slackRefs.markFailed, {
        connectSessionId: first.connectSessionId,
        expectedConnectionGeneration: first.connectionGeneration,
        now: 1_010,
      });
      const retry = yield* authed.mutation(slackRefs.prepare, {
        now: 1_210,
        attemptExpiresAt: 1_510,
        nonce: "retryopaque0000000000000000",
      });
      expect(retry.connectionGeneration).toBe(0);
      yield* authed.mutation(slackRefs.reconcileExpiry, {
        connectSessionId: retry.connectSessionId,
        attemptId: retry.attemptId,
        expectedConnectionGeneration: retry.connectionGeneration,
        providerExpiresAt: 1_500,
        localMaxExpiresAt: 1_510,
        now: 1_210,
      });
      const authorization = yield* authed.mutation(slackRefs.authorize, {
        connectSessionId: retry.connectSessionId,
        connectionId: "provider-conn-retry",
        now: 1_220,
      });
      expect(authorization.alreadyCompleted).toBe(false);
      yield* authed.mutation(slackRefs.claim, {
        connectSessionId: retry.connectSessionId,
        connectionId: "provider-conn-retry",
        providerOrganizationKey: retry.nangoOrganizationId,
        providerEndUserId: retry.nangoEndUserId,
        providerConfigKey: "slack",
        correlationTag: retry.correlationTag,
        now: 1_220,
      });
      const finalized = yield* authed.mutation(slackRefs.finalize, {
        connectSessionId: retry.connectSessionId,
        connectionId: "provider-conn-retry",
        expectedConnectionGeneration: authorization.connectionGeneration,
        now: 1_230,
      });
      expect(finalized).toMatchObject({ status: "verifying" });
      const completed = yield* authed.mutation(slackRefs.authorize, {
        connectSessionId: retry.connectSessionId,
        connectionId: "provider-conn-retry",
        now: 9_999,
      });
      expect(completed.alreadyCompleted).toBe(true);
      yield* confect.run(
        Effect.gen(function* () {
          yield* (yield* DatabaseWriter)
            .table("organizationMembers")
            .patch(seeded.memberId, { status: "revoked", revokedAt: 1_240 })
            .pipe(Effect.orDie);
        }),
      );
      const demotedRetry = yield* Effect.either(
        authed.mutation(slackRefs.authorize, {
          connectSessionId: retry.connectSessionId,
          connectionId: "provider-conn-retry",
          now: 10_000,
        }),
      );
      expect(Either.isLeft(demotedRetry)).toBe(true);
      if (Either.isLeft(demotedRetry)) {
        expect(demotedRetry.left).toMatchObject({ _tag: "Forbidden" });
      }
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(slackTestConfectLayer())),
    );
  });

  it("executes public Slack connect actions with provider fencing", async () => {
    const originalMode = process.env.APP_PROVIDER_MODE;
    const originalSecret = process.env.NANGO_SECRET_KEY;
    const originalIntegration = process.env.NANGO_CONNECT_INTEGRATION_ID;

    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      const authed = confect.withIdentity(identity);
      const seeded = yield* confect.run(
        Effect.gen(function* () {
          const writer = yield* DatabaseWriter;
          const userId = yield* writer
            .table("users")
            .insert({
              subject: "member-subject",
              email: "member@example.com",
              displayName: "Member",
              status: "active",
              createdAt: 3_000,
              updatedAt: 3_000,
            })
            .pipe(Effect.orDie);
          const organizationId = yield* writer
            .table("organizations")
            .insert({
              ownerUserId: userId,
              name: "Acme",
              slug: "acme-public-actions",
              status: "active",
              workosOrganizationId: "workos_acme",
              agencyKey: "agency_acme",
              createdAt: 3_000,
              updatedAt: 3_000,
            })
            .pipe(Effect.orDie);
          const memberId = yield* writer
            .table("organizationMembers")
            .insert({
              organizationId,
              userId,
              role: "admin",
              status: "active",
              acceptedAt: 3_000,
              revokedAt: null,
              createdAt: 3_000,
              updatedAt: 3_000,
            })
            .pipe(Effect.orDie);
          return { memberId };
        }),
        Schema.Struct({ memberId: Id("organizationMembers") }),
      );
      const rowForSession = (connectSessionId: string) =>
        confect.run(
          Effect.gen(function* () {
            const row = yield* (
              (yield* DatabaseReader) as unknown as {
                table: (name: "providerConnections") => {
                  index: (
                    name: "by_connect_session",
                    range: (q: {
                      eq: (field: string, value: string) => unknown;
                    }) => unknown,
                  ) => { first: () => Effect.Effect<unknown, unknown> };
                };
              }
            )
              .table("providerConnections")
              .index("by_connect_session", (q) =>
                q.eq("connectSessionId", connectSessionId),
              )
              .first()
              .pipe(Effect.orDie);
            return "value" in (row as object)
              ? (row as { value: unknown }).value
              : row;
          }),
          Schema.Any,
        );

      process.env.APP_PROVIDER_MODE = "live";
      delete process.env.NANGO_SECRET_KEY;
      delete process.env.NANGO_CONNECT_INTEGRATION_ID;
      const failedBegin = yield* Effect.either(
        authed.action(slackRefs.begin, {}),
      );
      expect(Either.isLeft(failedBegin)).toBe(true);
      if (Either.isLeft(failedBegin)) {
        expect(failedBegin.left).toMatchObject({ _tag: "ProviderUnavailable" });
      }
      const failedRow = yield* confect.run(
        Effect.gen(function* () {
          const rows = yield* (
            (yield* DatabaseReader) as unknown as {
              table: (name: "providerConnections") => {
                index: (
                  name: "by_organization",
                  range: (q: {
                    eq: (field: string, value: string) => unknown;
                  }) => unknown,
                ) => {
                  take: (count: number) => Effect.Effect<unknown, unknown>;
                };
              };
            }
          )
            .table("providerConnections")
            .index("by_organization", (q) =>
              q.eq("organizationKey", "agency_acme"),
            )
            .take(5)
            .pipe(Effect.orDie);
          return rows as readonly ProviderConnectionRowValue[];
        }),
        Schema.Any,
      );
      expect(failedRow).toHaveLength(1);
      expect(failedRow[0]).toMatchObject({ status: "error" });
      expect(JSON.stringify(failedRow[0])).not.toContain("connect_public_");

      process.env.APP_PROVIDER_MODE = "fake";
      const begin = yield* authed.action(slackRefs.begin, {});
      const reservedRow = yield* rowForSession(begin.connectSessionId);
      expect(reservedRow).toMatchObject({
        status: "authorizing",
        nangoOrganizationId: expect.stringMatching(/^nango-org-slack-/),
      });
      expect(JSON.stringify(reservedRow)).not.toContain(
        begin.connectSessionToken,
      );

      const complete = yield* authed.action(slackRefs.complete, {
        connectSessionId: begin.connectSessionId,
        connectionId: "provider-conn-public",
      });
      expect(complete).toEqual({
        connectionKey: "slack_agency_acme",
        status: "verifying",
        connectionGeneration: 0,
      });

      process.env.APP_PROVIDER_MODE = "live";
      delete process.env.NANGO_SECRET_KEY;
      delete process.env.NANGO_CONNECT_INTEGRATION_ID;
      const retry = yield* authed.action(slackRefs.complete, {
        connectSessionId: begin.connectSessionId,
        connectionId: "provider-conn-public",
      });
      expect(retry).toEqual(complete);
      const differingReplay = yield* Effect.either(
        authed.action(slackRefs.complete, {
          connectSessionId: begin.connectSessionId,
          connectionId: "provider-conn-replay",
        }),
      );
      expect(Either.isLeft(differingReplay)).toBe(true);
      if (Either.isLeft(differingReplay)) {
        expect(differingReplay.left).toMatchObject({
          _tag: "ConnectSessionInvalid",
        });
      }

      yield* confect.run(
        Effect.gen(function* () {
          yield* (yield* DatabaseWriter)
            .table("organizationMembers")
            .patch(seeded.memberId, { status: "revoked", revokedAt: 3_100 })
            .pipe(Effect.orDie);
        }),
      );
      const demotedRetry = yield* Effect.either(
        authed.action(slackRefs.complete, {
          connectSessionId: begin.connectSessionId,
          connectionId: "provider-conn-public",
        }),
      );
      expect(Either.isLeft(demotedRetry)).toBe(true);
      if (Either.isLeft(demotedRetry)) {
        expect(demotedRetry.left).toMatchObject({ _tag: "Forbidden" });
      }
    });

    try {
      await Effect.runPromise(
        program.pipe(Effect.provide(slackTestConfectLayer())),
      );
    } finally {
      if (originalMode === undefined) delete process.env.APP_PROVIDER_MODE;
      else process.env.APP_PROVIDER_MODE = originalMode;
      if (originalSecret === undefined) delete process.env.NANGO_SECRET_KEY;
      else process.env.NANGO_SECRET_KEY = originalSecret;
      if (originalIntegration === undefined)
        delete process.env.NANGO_CONNECT_INTEGRATION_ID;
      else process.env.NANGO_CONNECT_INTEGRATION_ID = originalIntegration;
    }
  });

  it("declares durable provider connection attempts without token fields", () => {
    expect(providerConnections).toBeTruthy();
    const row = ProviderConnectionRow.make({
      provider: "nango",
      providerConfigKey: "slack",
      organizationKey: "org_acme",
      connectionKey: "slack_org_acme",
      connectionGeneration: 0,
      status: "authorizing",
      connectSessionId: "maestro-session-org-acme-1",
      nangoEndUserId: "org_acme",
      nangoOrganizationId: "org_acme",
      correlationTag: "slack-connect:org_acme:1",
      attemptId: "attempt_org_acme_1",
      attemptExpiresAt: 301,
      createdAt: 1,
      updatedAt: 1,
    });

    expect(row).toMatchObject({
      status: "authorizing",
      connectionGeneration: 0,
      connectSessionId: "maestro-session-org-acme-1",
    });
    expect(JSON.stringify(row)).not.toContain("connectSessionToken");
    expect(JSON.stringify(row)).not.toContain("xox");
  });

  it("selects the exact current WorkOS organization and fails closed", () => {
    const result = selectCurrentSlackOrganization({
      memberships: [
        { organizationId: "organizations_1", role: "owner", status: "active" },
        { organizationId: "organizations_2", role: "admin", status: "active" },
      ],
      organizationsById: new Map([
        [
          "organizations_1",
          {
            _id: "organizations_1",
            agencyKey: "agency_wrong",
            status: "active",
            workosOrganizationId: "org_wrong",
          },
        ],
        [
          "organizations_2",
          {
            _id: "organizations_2",
            agencyKey: "agency_current",
            status: "active",
            workosOrganizationId: "org_current",
          },
        ],
      ]),
      currentWorkosOrganizationId: "org_current",
    });

    expect(Either.getOrThrow(result)).toMatchObject({
      agencyKey: "agency_current",
    });
    expect(
      Either.isLeft(
        selectCurrentSlackOrganization({
          memberships: [
            {
              organizationId: "organizations_1",
              role: "owner",
              status: "active",
            },
          ],
          organizationsById: new Map([
            [
              "organizations_1",
              {
                _id: "organizations_1",
                agencyKey: "agency_wrong",
                status: "active",
                workosOrganizationId: "org_wrong",
              },
            ],
          ]),
        }),
      ),
    ).toBe(true);
    expect(
      Either.isLeft(
        selectCurrentSlackOrganization({
          memberships: [
            {
              organizationId: "organizations_1",
              role: "owner",
              status: "active",
            },
          ],
          organizationsById: new Map([
            [
              "organizations_1",
              {
                _id: "organizations_1",
                agencyKey: "agency_wrong",
                status: "active",
                workosOrganizationId: "org_wrong",
              },
            ],
          ]),
          currentWorkosOrganizationId: "org_missing",
        }),
      ),
    ).toBe(true);
  });

  it("uses opaque nondeterministic Maestro session ids and opaque Nango tenant ids", () => {
    const ids = makeSlackConnectAttemptIds({
      organizationKey: "agency_acme",
      nonce: "aB0_-cdefghijklmnopqrstu",
      now: 1_782_924_800_000,
    });

    expect(
      validateOpaqueSlackConnectIds({ ...ids, organizationKey: "agency_acme" }),
    ).toBe(true);
    expect(ids.connectSessionId).toMatch(/^maestro-session-/);
    expect(ids.connectSessionId).not.toContain("agency_acme");
    expect(ids.nangoEndUserId).not.toContain("agency_acme");
    expect(ids.nangoOrganizationId).not.toContain("agency_acme");
    expect(ids.nangoOrganizationId).toBe(
      "nango-org-slack-aB0_-cdefghijklmnopqrstu",
    );
    expect(
      makeSlackConnectAttemptIds({
        organizationKey: "agency_other",
        nonce: "aB0_-cdefghijklmnopqrstv",
        now: 1_782_924_800_000,
      }).nangoOrganizationId,
    ).not.toBe(ids.nangoOrganizationId);
  });

  it("reserves only one current attempt while allowing active reauthorization", () => {
    const activeRow: ProviderConnectionRowValue = {
      _id: "providerConnections_active" as never,
      provider: "nango",
      providerConfigKey: "slack",
      organizationKey: "agency_acme",
      connectionKey: "slack_agency_acme",
      connectionGeneration: 3,
      status: "active",
      connectSessionId: "maestro-session-oldopaque0000000000",
      nangoEndUserId: "nango-user-old",
      nangoOrganizationId: "nango-org-old",
      correlationTag: "slack-connect:maestro-session-oldopaque0000000000",
      attemptId: "attempt_old",
      attemptExpiresAt: 2,
    };
    const authorizingRow: ProviderConnectionRowValue = {
      ...activeRow,
      status: "authorizing",
      connectSessionId: "maestro-session-currentopaque000000",
      attemptExpiresAt: 20,
    };

    expect(
      Either.getOrThrow(
        reserveSlackConnectAttemptPlan({
          organizationKey: "agency_acme",
          connectSessionId: "maestro-session-newopaque0000000000",
          currentConnection: activeRow,
          now: 10,
        }),
      ),
    ).toEqual({ status: "reauthorize" });
    const concurrent = reserveSlackConnectAttemptPlan({
      organizationKey: "agency_acme",
      connectSessionId: "maestro-session-otheropaque0000000",
      currentConnection: authorizingRow,
      now: 10,
    });
    expect(Either.isLeft(concurrent)).toBe(true);
    if (Either.isLeft(concurrent)) {
      expect(concurrent.left).toMatchObject({
        _tag: "ConnectionAlreadyExists",
      });
    }
  });

  it("reconciles provider expiry only for the same fenced attempt", () => {
    const row: ProviderConnectionRowValue = {
      _id: "providerConnections_expiry" as never,
      provider: "nango",
      providerConfigKey: "slack",
      organizationKey: "agency_acme",
      connectionKey: "slack_agency_acme",
      connectionGeneration: 2,
      status: "reauthorizing",
      connectSessionId: "maestro-session-expiryopaque000",
      nangoEndUserId: "nango-user-opaque",
      nangoOrganizationId: "nango-org-opaque",
      correlationTag: "slack-connect:maestro-session-expiryopaque000",
      attemptId: "attempt_expiry",
      attemptExpiresAt: 1_300,
    };

    expect(
      Either.getOrThrow(
        reconcileSlackConnectSessionExpiryPlan({
          row,
          attemptId: "attempt_expiry",
          expectedConnectionGeneration: 2,
          providerExpiresAt: 1_200,
          localMaxExpiresAt: 1_300,
          now: 1_000,
        }),
      ),
    ).toMatchObject({ attemptExpiresAt: 1_200 });
    for (const providerExpiresAt of [999, 1_301, Number.NaN]) {
      const invalid = reconcileSlackConnectSessionExpiryPlan({
        row,
        attemptId: "attempt_expiry",
        expectedConnectionGeneration: 2,
        providerExpiresAt,
        localMaxExpiresAt: 1_300,
        now: 1_000,
      });
      expect(Either.isLeft(invalid)).toBe(true);
      if (Either.isLeft(invalid)) {
        expect(invalid.left).toMatchObject({ _tag: "ProviderUnavailable" });
      }
    }
    const stale = reconcileSlackConnectSessionExpiryPlan({
      row,
      attemptId: "attempt_stale",
      expectedConnectionGeneration: 2,
      providerExpiresAt: 1_200,
      localMaxExpiresAt: 1_300,
      now: 1_000,
    });
    expect(Either.isLeft(stale)).toBe(true);
    if (Either.isLeft(stale)) {
      expect(stale.left).toMatchObject({ _tag: "ConnectSessionInvalid" });
    }
  });

  it("preserves connection generation across failed or abandoned reauthorization attempts", () => {
    const activeRow: ProviderConnectionRowValue = {
      _id: "providerConnections_active_generation" as never,
      provider: "nango",
      providerConfigKey: "slack",
      organizationKey: "agency_acme",
      connectionKey: "slack_agency_acme",
      connectionGeneration: 7,
      status: "active",
      connectSessionId: "maestro-session-activeopaque0000",
      nangoEndUserId: "nango-user-active",
      nangoOrganizationId: "nango-org-active",
      correlationTag: "slack-connect:maestro-session-activeopaque0000",
      attemptId: "attempt_active",
      attemptExpiresAt: 5,
    };
    const failedReauthRow: ProviderConnectionRowValue = {
      ...activeRow,
      status: "error",
      connectSessionId: "maestro-session-failedreauth000",
      attemptId: "attempt_failed_reauth",
      attemptExpiresAt: 8,
    };
    const abandonedReauthRow: ProviderConnectionRowValue = {
      ...activeRow,
      status: "reauthorizing",
      connectSessionId: "maestro-session-abandonedreauth",
      attemptId: "attempt_abandoned_reauth",
      attemptExpiresAt: 8,
    };

    expect(
      Either.getOrThrow(
        reserveSlackConnectAttemptPlan({
          organizationKey: "agency_acme",
          connectSessionId: "maestro-session-newreauthopaque",
          currentConnection: activeRow,
          now: 6,
        }),
      ),
    ).toEqual({ status: "reauthorize" });
    expect(
      Either.getOrThrow(
        reserveSlackConnectAttemptPlan({
          organizationKey: "agency_acme",
          connectSessionId: "maestro-session-retryfailedopaque",
          currentConnection: failedReauthRow,
          now: 9,
        }),
      ),
    ).toEqual({ status: "takeover" });
    expect(
      Either.getOrThrow(
        reserveSlackConnectAttemptPlan({
          organizationKey: "agency_acme",
          connectSessionId: "maestro-session-retryabandoned",
          currentConnection: abandonedReauthRow,
          now: 9,
        }),
      ),
    ).toEqual({ status: "takeover" });
    expect(
      slackConnectAttemptGenerationFor({ currentConnection: activeRow }),
    ).toBe(7);
    expect(
      slackConnectAttemptGenerationFor({ currentConnection: failedReauthRow }),
    ).toBe(7);
    expect(
      slackConnectAttemptGenerationFor({
        currentConnection: abandonedReauthRow,
      }),
    ).toBe(7);
  });

  it("classifies failed reauthorization retries separately from initial errors", () => {
    const initialError: ProviderConnectionRowValue = {
      _id: "providerConnections_initial_error" as never,
      provider: "nango",
      providerConfigKey: "slack",
      organizationKey: "agency_acme",
      connectionKey: "slack_agency_acme",
      connectionGeneration: 0,
      status: "error",
      connectSessionId: "maestro-session-initialerror",
      nangoEndUserId: "nango-user-initial",
      nangoOrganizationId: "nango-org-initial",
      correlationTag: "slack-connect:maestro-session-initialerror",
      attemptId: "attempt_initial_error",
      attemptExpiresAt: 8,
    };
    const failedReauth: ProviderConnectionRowValue = {
      ...initialError,
      _id: "providerConnections_reauth_error" as never,
      connectionGeneration: 7,
      nangoConnectionId: "provider-conn-stable",
      teamId: "TSTABLE",
      status: "error",
    };

    expect(
      slackConnectAttemptStatusFor({ currentConnection: initialError }),
    ).toBe("authorizing");
    expect(
      slackConnectAttemptStatusFor({ currentConnection: failedReauth }),
    ).toBe("reauthorizing");
  });

  it("marks reserved config failures as retryable errors", async () => {
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
              createdAt: 2_000,
              updatedAt: 2_000,
            })
            .pipe(Effect.orDie);
          const organizationId = yield* writer
            .table("organizations")
            .insert({
              ownerUserId: userId,
              name: "Acme",
              slug: "acme-config-failure",
              status: "active",
              workosOrganizationId: "workos_acme",
              agencyKey: "agency_acme",
              createdAt: 2_000,
              updatedAt: 2_000,
            })
            .pipe(Effect.orDie);
          yield* writer
            .table("organizationMembers")
            .insert({
              organizationId,
              userId,
              role: "admin",
              status: "active",
              acceptedAt: 2_000,
              revokedAt: null,
              createdAt: 2_000,
              updatedAt: 2_000,
            })
            .pipe(Effect.orDie);
        }),
      );
      const attempt = yield* authed.mutation(slackRefs.prepare, {
        now: 2_000,
        attemptExpiresAt: 2_300,
        nonce: "configfailure0000000000000",
      });
      yield* authed.mutation(slackRefs.markFailed, {
        connectSessionId: attempt.connectSessionId,
        expectedConnectionGeneration: attempt.connectionGeneration,
        now: 2_001,
      });
      const retry = yield* authed.mutation(slackRefs.prepare, {
        now: 2_002,
        attemptExpiresAt: 2_302,
        nonce: "configretry0000000000000000",
      });
      expect(retry.connectionGeneration).toBe(attempt.connectionGeneration);
      expect(retry.connectSessionId).not.toBe(attempt.connectSessionId);
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(slackTestConfectLayer())),
    );
  });

  it("claims the provider connection id before finalization", async () => {
    const program = Effect.gen(function* () {
      const confect = yield* Effect.serviceOptional(
        TestConfect.TestConfect<typeof transientDatabaseSchema>(),
      );
      yield* confect.run(
        Effect.gen(function* () {
          const rowId = yield* (
            (yield* DatabaseWriter) as unknown as {
              table: (name: "providerConnections") => {
                insert: (
                  row: Record<string, unknown>,
                ) => Effect.Effect<unknown, unknown>;
              };
            }
          )
            .table("providerConnections")
            .insert({
              provider: "nango",
              providerConfigKey: "slack",
              organizationKey: "agency_acme",
              connectionKey: "slack_agency_acme",
              connectionGeneration: 0,
              status: "authorizing",
              connectSessionId: "maestro-session-claimopaque000",
              nangoEndUserId: "nango-user-opaque",
              nangoOrganizationId: "nango-org-opaque",
              correlationTag: "slack-connect:maestro-session-claimopaque000",
              attemptId: "attempt_claim",
              attemptExpiresAt: 2_300,
              createdAt: 2_000,
              updatedAt: 2_000,
            })
            .pipe(Effect.orDie);

          const claimed = yield* confect.mutation(slackRefs.claim, {
            connectSessionId: "maestro-session-claimopaque000",
            connectionId: "provider-conn-claimed",
            providerOrganizationKey: "nango-org-opaque",
            providerEndUserId: "nango-user-opaque",
            providerConfigKey: "slack",
            correlationTag: "slack-connect:maestro-session-claimopaque000",
            now: 2_010,
          });
          const row = (yield* (
            (yield* DatabaseReader) as unknown as {
              table: (name: "providerConnections") => {
                get: (id: unknown) => Effect.Effect<unknown, unknown>;
              };
            }
          )
            .table("providerConnections")
            .get(rowId)
            .pipe(Effect.orDie)) as ProviderConnectionRowValue | null;

          expect(claimed).toEqual({
            connectionKey: "slack_agency_acme",
            status: "verifying",
          });
          expect(row?.status).toBe("authorizing");
          expect(row?.nangoConnectionId).toBe("provider-conn-claimed");
          expect((row as { updatedAt?: number } | null)?.updatedAt).toBe(2_010);
        }),
      );
    });

    await Effect.runPromise(
      program.pipe(Effect.provide(slackTestConfectLayer())),
    );
  });

  it("permits expired or failed attempt takeover while rejecting stale callbacks", () => {
    const expiredRow: ProviderConnectionRowValue = {
      _id: "providerConnections_expired" as never,
      provider: "nango",
      providerConfigKey: "slack",
      organizationKey: "agency_acme",
      connectionKey: "slack_agency_acme",
      connectionGeneration: 2,
      status: "authorizing",
      connectSessionId: "maestro-session-expiredopaque000",
      nangoEndUserId: "nango-user-old",
      nangoOrganizationId: "nango-org-old",
      correlationTag: "slack-connect:maestro-session-expiredopaque000",
      attemptId: "attempt_expired",
      attemptExpiresAt: 5,
    };

    expect(
      Either.getOrThrow(
        reserveSlackConnectAttemptPlan({
          organizationKey: "agency_acme",
          connectSessionId: "maestro-session-newopaque0000000000",
          currentConnection: expiredRow,
          now: 10,
        }),
      ),
    ).toEqual({ status: "takeover" });
    expect(
      Either.isLeft(
        finalizeSlackConnectAttemptPlan({
          row: expiredRow,
          connectionId: "stale-provider-connection",
          expectedConnectionGeneration: 1,
          now: 10,
        }),
      ),
    ).toBe(true);
  });

  it("denies exact completed retry after demotion or org switch before provider verification", () => {
    const completedRow: ProviderConnectionRowValue = {
      _id: "providerConnections_completed" as never,
      provider: "nango",
      providerConfigKey: "slack",
      organizationKey: "agency_acme",
      connectionKey: "slack_agency_acme",
      connectionGeneration: 4,
      status: "verifying",
      connectSessionId: "maestro-session-completedopaque000",
      nangoConnectionId: "provider-conn-completed",
      nangoEndUserId: "nango-user-opaque",
      nangoOrganizationId: "nango-org-opaque",
      correlationTag: "slack-connect:maestro-session-completedopaque000",
      attemptId: "attempt_completed",
      attemptExpiresAt: 5,
    };

    const demoted = authorizeSlackConnectCompletionPlan({
      row: completedRow,
      connectionId: "provider-conn-completed",
      currentOrganizationKey: null,
      now: 10,
    });
    const switched = authorizeSlackConnectCompletionPlan({
      row: completedRow,
      connectionId: "provider-conn-completed",
      currentOrganizationKey: "agency_other",
      now: 10,
    });

    expect(Either.isLeft(demoted)).toBe(true);
    if (Either.isLeft(demoted)) {
      expect(demoted.left).toMatchObject({ _tag: "Forbidden" });
    }
    expect(Either.isLeft(switched)).toBe(true);
    if (Either.isLeft(switched)) {
      expect(switched.left).toMatchObject({ _tag: "TenantMismatch" });
    }
    expect(
      Either.getOrThrow(
        authorizeSlackConnectCompletionPlan({
          row: completedRow,
          connectionId: "provider-conn-completed",
          currentOrganizationKey: "agency_acme",
          now: 10,
        }),
      ),
    ).toMatchObject({ alreadyCompleted: true, connectionGeneration: 4 });
  });

  it("allows exact completed retry after expiry but rejects different replay", () => {
    const row: ProviderConnectionRowValue = {
      _id: "providerConnections_retry" as never,
      provider: "nango",
      providerConfigKey: "slack",
      organizationKey: "agency_acme",
      connectionKey: "slack_agency_acme",
      connectionGeneration: 4,
      status: "verifying",
      connectSessionId: "maestro-session-completedopaque000",
      nangoConnectionId: "provider-conn-completed",
      nangoEndUserId: "nango-user-opaque",
      nangoOrganizationId: "nango-org-opaque",
      correlationTag: "slack-connect:maestro-session-completedopaque000",
      attemptId: "attempt_completed",
      attemptExpiresAt: 5,
    };

    let providerCalls = 0;
    const authorization = {
      alreadyCompleted: true,
      connectionKey: row.connectionKey,
      status: "verifying" as const,
      connectionGeneration: row.connectionGeneration,
    };
    if (!authorization.alreadyCompleted) providerCalls += 1;

    expect(providerCalls).toBe(0);
    expect(authorization).toMatchObject({
      connectionKey: "slack_agency_acme",
      status: "verifying",
      connectionGeneration: 4,
    });
    expect(
      Either.getOrThrow(
        finalizeSlackConnectAttemptPlan({
          row,
          connectionId: "provider-conn-completed",
          expectedConnectionGeneration: 4,
          now: 10,
        }),
      ),
    ).toMatchObject({
      connectionKey: "slack_agency_acme",
      status: "verifying",
    });
    const mismatchedAuthorization = authorizeSlackConnectCompletionPlan({
      row,
      connectionId: "provider-conn-replay",
      currentOrganizationKey: "agency_acme",
      now: 10,
    });
    if (Either.isRight(mismatchedAuthorization)) {
      providerCalls += 1;
    }

    expect(providerCalls).toBe(0);
    expect(Either.isLeft(mismatchedAuthorization)).toBe(true);
    if (Either.isLeft(mismatchedAuthorization)) {
      expect(mismatchedAuthorization.left).toMatchObject({
        _tag: "ConnectSessionInvalid",
      });
    }
    expect(
      Either.isLeft(
        finalizeSlackConnectAttemptPlan({
          row,
          connectionId: "provider-conn-replay",
          expectedConnectionGeneration: 4,
          now: 10,
        }),
      ),
    ).toBe(true);
  });

  it("finalizes by patching only the current attempt generation", () => {
    const row: ProviderConnectionRowValue = {
      _id: "providerConnections_finalize" as never,
      provider: "nango",
      providerConfigKey: "slack",
      organizationKey: "agency_acme",
      connectionKey: "slack_agency_acme",
      connectionGeneration: 2,
      status: "reauthorizing",
      connectSessionId: "maestro-session-currentopaque000000",
      nangoEndUserId: "nango-user-opaque",
      nangoOrganizationId: "nango-org-opaque",
      correlationTag: "slack-connect:maestro-session-currentopaque000000",
      attemptId: "attempt_current",
      attemptExpiresAt: 3,
    };

    const stale = finalizeSlackConnectAttemptPlan({
      row,
      connectionId: "provider-conn-current",
      expectedConnectionGeneration: 1,
      now: 2,
    });
    expect(Either.isLeft(stale)).toBe(true);
    expect(
      Either.getOrThrow(
        finalizeSlackConnectAttemptPlan({
          row,
          connectionId: "provider-conn-current",
          expectedConnectionGeneration: 2,
          now: 2,
        }),
      ),
    ).toMatchObject({
      connectionKey: "slack_agency_acme",
      status: "verifying",
      patch: {
        status: "verifying",
        nangoConnectionId: "provider-conn-current",
      },
    });
  });

  it("denies signed-out and non-admin users before creating provider sessions", () => {
    const signedOut = beginSlackConnectPlan({
      principal: null,
      existingConnection: null,
      now: 1,
    });
    const nonAdmin = beginSlackConnectPlan({
      principal: { organizationKey: "org_acme", role: "editor" },
      existingConnection: null,
      now: 1,
    });

    expect(Either.isLeft(signedOut)).toBe(true);
    if (Either.isLeft(signedOut)) {
      expect(signedOut.left).toMatchObject({ _tag: "Unauthorized" });
    }
    expect(Either.isLeft(nonAdmin)).toBe(true);
    if (Either.isLeft(nonAdmin)) {
      expect(nonAdmin.left).toMatchObject({ _tag: "Forbidden" });
    }
  });

  it("allows active reauthorization but rejects raw token shaped callback values", () => {
    const existingConnection: SlackConnectionState = {
      organizationKey: "org_acme",
      connectionKey: "slack_org_acme",
      connectionGeneration: 1,
      status: "active",
      nangoConnectionId: "opaque-nango-connection",
    };

    const reauthorization = beginSlackConnectPlan({
      principal: { organizationKey: "org_acme", role: "admin" },
      existingConnection,
      now: 1,
    });
    const rawToken = completeSlackConnectPlan({
      principal: { organizationKey: "org_acme", role: "admin" },
      pending: null,
      connectionId: `xox${"b"}-raw-token`,
      connectSessionId: "connect_public_session_token",
      providerOrganizationKey: "org_acme",
    });

    expect(Either.isRight(reauthorization)).toBe(true);
    expect(Either.isLeft(rawToken)).toBe(true);
    if (Either.isLeft(rawToken)) {
      expect(rawToken.left).toMatchObject({ _tag: "ConnectSessionInvalid" });
    }
  });

  it("denies signed-out and non-admin completion before provider verification", () => {
    const pending = Either.getOrThrow(
      beginSlackConnectPlan({
        principal: { organizationKey: "org_acme", role: "owner" },
        existingConnection: null,
        now: 1_782_924_800_000,
      }),
    );

    for (const principal of [
      null,
      { organizationKey: "org_acme", role: "editor" as const },
    ]) {
      const result = completeSlackConnectPlan({
        principal,
        pending,
        connectionId: "opaque-nango-connection",
        connectSessionId: pending.connectSessionId,
        providerOrganizationKey: "org_acme",
      });

      expect(Either.isLeft(result)).toBe(true);
      if (Either.isLeft(result)) {
        expect(["Unauthorized", "Forbidden"]).toContain(result.left._tag);
      }
    }
  });

  it("requires tenant-bound connect sessions and returns verifying state", () => {
    const pending = Either.getOrThrow(
      beginSlackConnectPlan({
        principal: { organizationKey: "org_acme", role: "owner" },
        existingConnection: null,
        now: 1_782_924_800_000,
      }),
    );

    const tenantMismatch = completeSlackConnectPlan({
      principal: { organizationKey: "org_acme", role: "owner" },
      pending,
      connectionId: "opaque-other-connection",
      connectSessionId: pending.connectSessionId,
      providerOrganizationKey: "org_other",
    });

    expect(Either.isLeft(tenantMismatch)).toBe(true);
    if (Either.isLeft(tenantMismatch)) {
      expect(tenantMismatch.left).toMatchObject({ _tag: "TenantMismatch" });
    }
    expect(
      Either.getOrThrow(
        completeSlackConnectPlan({
          principal: { organizationKey: "org_acme", role: "owner" },
          pending,
          connectionId: "opaque-nango-connection",
          connectSessionId: pending.connectSessionId,
          providerOrganizationKey: "org_acme",
        }),
      ),
    ).toEqual({
      connectionKey: "slack_org_acme",
      status: "verifying",
      connectionGeneration: 0,
    });
    expect(JSON.stringify(pending)).not.toContain("secret");
  });

  it("treats Nango event identifiers as opaque and keeps Maestro sessions separate from provider tokens", () => {
    const pending = Either.getOrThrow(
      beginSlackConnectPlan({
        principal: { organizationKey: "org_acme", role: "owner" },
        existingConnection: null,
        now: 1_782_924_800_000,
      }),
    );

    expect(pending.connectSessionId).not.toBe(pending.connectSessionToken);
    expect(pending.connectSessionId).not.toContain("connect_public_");
    expect(
      Either.getOrThrow(
        completeSlackConnectPlan({
          principal: { organizationKey: "org_acme", role: "owner" },
          pending,
          connectionId: "opaque-provider-event-value",
          connectSessionId: pending.connectSessionId,
          providerOrganizationKey: "org_acme",
        }),
      ),
    ).toMatchObject({ status: "verifying" });
  });
});
