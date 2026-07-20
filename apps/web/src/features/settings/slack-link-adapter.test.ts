import { describe, expect, it } from "vitest";

import {
  buildSlackLinkStatusView,
  redactSlackLinkToken,
} from "./slack-link-adapter";

describe("Slack link settings adapter", () => {
  it("keeps Slack identity linking unavailable without a workspace", () => {
    expect(
      buildSlackLinkStatusView({
        workspace: null,
        binding: null,
        viewerRole: "owner",
      }),
    ).toEqual({
      heading: "Slack identity link unavailable",
      body: ["Slack linking requires a server-derived active workspace."],
      canLink: false,
    });
  });

  it("renders exact binding metadata without token or identity inference", () => {
    const view = buildSlackLinkStatusView({
      workspace: { organizationId: "org_acme", workspaceId: "workspace_acme" },
      viewerRole: "editor",
      binding: {
        status: "active",
        teamId: "T_acme",
        slackUserId: "U_requester",
        connectionGeneration: 2,
        bindingGeneration: 3,
        verifiedAt: 1_200,
      },
    });

    expect(view).toEqual({
      heading: "Slack identity linked",
      body: [
        "Slack user: U_requester",
        "Slack team: T_acme",
        "Binding generation: 3",
        "Connection generation: 2",
        "Verified at: 1200",
      ],
      canLink: true,
    });
    expect(JSON.stringify(view)).not.toContain("email");
    expect(JSON.stringify(view)).not.toContain("displayName");
  });

  it("redacts single-use link tokens from settings output", () => {
    expect(
      redactSlackLinkToken("slack-link:agency_acme:T_acme:sha256:nonce"),
    ).toBe("slack-link:[redacted]");
  });
});
