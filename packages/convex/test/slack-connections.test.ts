import { readFileSync } from "node:fs";
import * as Either from "effect/Either";
import { describe, expect, it } from "vitest";

import slackConnections, {
  ConnectionAlreadyExists,
  TenantMismatch,
} from "../confect/integrations/slackConnections.spec";
import {
  beginSlackConnectPlan,
  completeSlackConnectPlan,
  finalizeSlackConnectAttemptPlan,
  makeSlackConnectAttemptIds,
  reserveSlackConnectAttemptPlan,
  selectCurrentSlackOrganization,
  validateOpaqueSlackConnectIds,
  type ProviderConnectionRow as ProviderConnectionRowValue,
  type SlackConnectionState,
} from "../confect/integrations/slackConnections.impl";
import providerConnections, {
  ProviderConnectionRow,
} from "../confect/tables/providerConnections";

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
    expect(slackConnections.functions.reserveSlackConnectAttempt).toMatchObject(
      {
        functionVisibility: "internal",
        name: "reserveSlackConnectAttempt",
      },
    );
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

  it("selects the current WorkOS organization instead of the first membership", () => {
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
    };

    expect(
      Either.getOrThrow(
        reserveSlackConnectAttemptPlan({
          organizationKey: "agency_acme",
          connectSessionId: "maestro-session-newopaque0000000000",
          currentConnection: activeRow,
        }),
      ),
    ).toEqual({ status: "reauthorize" });
    const concurrent = reserveSlackConnectAttemptPlan({
      organizationKey: "agency_acme",
      connectSessionId: "maestro-session-otheropaque0000000",
      currentConnection: authorizingRow,
    });
    expect(Either.isLeft(concurrent)).toBe(true);
    if (Either.isLeft(concurrent)) {
      expect(concurrent.left).toMatchObject({
        _tag: "ConnectionAlreadyExists",
      });
    }
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
      connectSessionId: "cs_org_acme",
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
