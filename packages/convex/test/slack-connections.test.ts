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

describe("Slack connection capability contract", () => {
  it("declares begin and complete Slack connect functions with typed errors", () => {
    const spec = JSON.stringify(slackConnections);

    expect(spec).toContain("beginSlackConnect");
    expect(spec).toContain("completeSlackConnect");
    expect(
      new ConnectionAlreadyExists({ organizationKey: "org_acme" }),
    ).toMatchObject({
      _tag: "ConnectionAlreadyExists",
    });
    expect(new TenantMismatch()).toMatchObject({ _tag: "TenantMismatch" });
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

  it("requires tenant-bound connect sessions and returns redacted active state", () => {
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
      status: "active",
      connectionGeneration: 1,
    });
    expect(JSON.stringify(pending)).not.toContain("secret");
  });
});
