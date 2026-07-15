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
      connectSessionId: "cs_org_acme_1",
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
      connectSessionId: "cs_org_acme_1",
    });
    expect(JSON.stringify(row)).not.toContain("connectSessionToken");
    expect(JSON.stringify(row)).not.toContain("xox");
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

  it("rejects a second active connection and raw token shaped callback values", () => {
    const existingConnection: SlackConnectionState = {
      organizationKey: "org_acme",
      connectionKey: "slack_org_acme",
      connectionGeneration: 1,
      status: "active",
      nangoConnectionId: "conn_org_acme",
    };

    const duplicate = beginSlackConnectPlan({
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

    expect(Either.isLeft(duplicate)).toBe(true);
    if (Either.isLeft(duplicate)) {
      expect(duplicate.left).toMatchObject({ _tag: "ConnectionAlreadyExists" });
    }
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
        connectionId: "conn_org_acme",
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
      connectionId: "conn_other",
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
          connectionId: "conn_org_acme",
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
});
