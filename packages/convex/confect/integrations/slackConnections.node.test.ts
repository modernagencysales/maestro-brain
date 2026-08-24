import { describe, expect, it } from "vitest";

import {
  nangoSlackConnectSessionBody,
  slackConnectBotScopes,
} from "./slackConnections.node";

describe("live Nango Slack Connect session", () => {
  it("binds the connection webhook and requests only the pilot bot scopes", () => {
    const body = nangoSlackConnectSessionBody(
      {
        organizationKey: "organization_acme",
        endUserId: "user_acme",
        providerConfigKey: "slack",
        correlationTag: "slack-connect:attempt_acme",
      },
      "https://brain.example.test/webhooks/nango",
    );
    const scopes = slackConnectBotScopes.join(",");
    const scopeSet = new Set<string>(slackConnectBotScopes);

    expect(body).toEqual({
      allowed_integrations: ["slack"],
      end_user: { id: "user_acme" },
      organization: { id: "organization_acme" },
      tags: { correlationTag: "slack-connect:attempt_acme" },
      integrations_config_defaults: {
        slack: {
          authorization_params: { scope: scopes },
          connection_config: { oauth_scopes_override: scopes },
        },
      },
      webhook_url_override: "https://brain.example.test/webhooks/nango",
    });
    expect(slackConnectBotScopes).toContain("app_mentions:read");
    expect(slackConnectBotScopes).toContain("channels:history");
    expect(slackConnectBotScopes).toContain("groups:history");
    expect(slackConnectBotScopes).toContain("im:history");
    expect(slackConnectBotScopes).toContain("chat:write");
    expect(scopeSet.has("channels:join")).toBe(false);
    expect(scopeSet.has("chat:write.public")).toBe(false);
    expect(scopeSet.has("users:read.email")).toBe(false);
  });
});
