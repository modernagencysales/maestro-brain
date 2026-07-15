import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import { NangoConnectButton, startNangoConnect } from "./nango-connect-button";

describe("NangoConnectButton", () => {
  it("renders disabled while the Slack connect feature flag is off", () => {
    const html = renderToStaticMarkup(
      <MaestroSaasUiProvider>
        <NangoConnectButton enabled={false} status="not_connected" />
      </MaestroSaasUiProvider>,
    );

    expect(html).toContain("Connect Slack");
    expect(html).toContain("disabled");
    expect(html).not.toContain("connect_public");
  });

  it("starts the narrow browser adapter without logging session tokens", async () => {
    const begin = vi.fn(async () => ({
      connectSessionId: "cs_org_acme",
      connectSessionToken: `connect_public_${"org_acme"}`,
      expiresAt: Date.now() + 60_000,
    }));
    const open = vi.fn(async () => ({ connectionId: "conn_org_acme" }));
    const complete = vi.fn(async () => ({
      connectionKey: "slack_org_acme",
      status: "verifying" as const,
    }));
    const log = vi.fn();

    await expect(
      startNangoConnect({ begin, open, complete, log }),
    ).resolves.toEqual({
      connectionKey: "slack_org_acme",
      status: "verifying",
    });
    expect(complete).toHaveBeenCalledWith({
      connectionId: "conn_org_acme",
      connectSessionId: "cs_org_acme",
    });
    expect(log).toHaveBeenCalledWith("slack_connect_completed", {
      connectionId: "conn_org_acme",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("connect_public");
    expect(JSON.stringify(log.mock.calls)).not.toContain("cs_org_acme");
  });
});
