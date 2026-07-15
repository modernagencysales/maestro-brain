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

const capture = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected function to throw");
};

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
    expect(
      capture(() =>
        beginSlackConnectPlan({
          principal: null,
          existingConnection: null,
          now: 1,
        }),
      ),
    ).toMatchObject({ _tag: "Unauthorized" });
    expect(
      capture(() =>
        beginSlackConnectPlan({
          principal: { organizationKey: "org_acme", role: "editor" },
          existingConnection: null,
          now: 1,
        }),
      ),
    ).toMatchObject({ _tag: "Forbidden" });
  });

  it("rejects a second active connection and raw token shaped callback values", () => {
    const existingConnection: SlackConnectionState = {
      organizationKey: "org_acme",
      connectionKey: "slack_org_acme",
      connectionGeneration: 1,
      status: "active",
      nangoConnectionId: "conn_org_acme",
    };

    expect(
      capture(() =>
        beginSlackConnectPlan({
          principal: { organizationKey: "org_acme", role: "admin" },
          existingConnection,
          now: 1,
        }),
      ),
    ).toMatchObject({ _tag: "ConnectionAlreadyExists" });
    expect(
      capture(() =>
        completeSlackConnectPlan({
          principal: { organizationKey: "org_acme", role: "admin" },
          pending: null,
          connectionId: `xox${"b"}-raw-token`,
          connectSessionId: "cs_org_acme",
          providerOrganizationKey: "org_acme",
        }),
      ),
    ).toMatchObject({ _tag: "ConnectSessionInvalid" });
  });

  it("requires tenant-bound connect sessions and returns redacted active state", () => {
    const pending = beginSlackConnectPlan({
      principal: { organizationKey: "org_acme", role: "owner" },
      existingConnection: null,
      now: 1_782_924_800_000,
    });

    expect(
      capture(() =>
        completeSlackConnectPlan({
          principal: { organizationKey: "org_acme", role: "owner" },
          pending,
          connectionId: "conn_other",
          connectSessionId: pending.connectSessionId,
          providerOrganizationKey: "org_other",
        }),
      ),
    ).toMatchObject({ _tag: "TenantMismatch" });

    expect(
      completeSlackConnectPlan({
        principal: { organizationKey: "org_acme", role: "owner" },
        pending,
        connectionId: "conn_org_acme",
        connectSessionId: pending.connectSessionId,
        providerOrganizationKey: "org_acme",
      }),
    ).toEqual({
      connectionKey: "slack_org_acme",
      status: "active",
      connectionGeneration: 1,
    });
    expect(JSON.stringify(pending)).not.toContain("secret");
  });
});
