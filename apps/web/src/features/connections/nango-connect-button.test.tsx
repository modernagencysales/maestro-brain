import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { MaestroSaasUiProvider } from "../../saas-ui/provider";
import { NangoConnectButton, startNangoConnect } from "./nango-connect-button";

describe("NangoConnectButton", () => {
  it("renders disabled while the Slack connect feature flag is off", () => {
    const html = renderToStaticMarkup(
      <MaestroSaasUiProvider>
        <NangoConnectButton
          enabled={false}
          onConnect={vi.fn()}
          status="not_connected"
        />
      </MaestroSaasUiProvider>,
    );

    expect(html).toContain("Connect Slack");
    expect(html).toContain("disabled");
    expect(html).not.toContain("connect_public");
  });

  it("exposes explicit reauthorization and in-progress states", () => {
    const active = renderToStaticMarkup(
      <MaestroSaasUiProvider>
        <NangoConnectButton
          enabled={true}
          onConnect={vi.fn()}
          status="active"
        />
      </MaestroSaasUiProvider>,
    );
    const verifying = renderToStaticMarkup(
      <MaestroSaasUiProvider>
        <NangoConnectButton
          enabled={true}
          onConnect={vi.fn()}
          status="verifying"
        />
      </MaestroSaasUiProvider>,
    );
    const reauthorizing = renderToStaticMarkup(
      <MaestroSaasUiProvider>
        <NangoConnectButton
          enabled={true}
          onConnect={vi.fn()}
          status="reauthorizing"
        />
      </MaestroSaasUiProvider>,
    );

    expect(active).toContain("Reauthorize Slack");
    expect(active).toContain("<button");
    expect(active).not.toContain("<button disabled");
    expect(verifying).toContain("Verifying Slack");
    expect(verifying).toContain("disabled");
    expect(reauthorizing).toContain("Reauthorizing Slack");
    expect(reauthorizing).toContain("disabled");
  });

  it("wires enabled clicks to the connect flow only once", async () => {
    const onConnect = vi.fn();
    const active = NangoConnectButton({
      enabled: true,
      status: "active",
      onConnect,
    });
    const disabled = NangoConnectButton({
      enabled: true,
      status: "reauthorizing",
      onConnect,
    });

    const activeButton = active as ReactElement<{
      readonly onClick?: () => void | Promise<void>;
    }>;
    const disabledButton = disabled as ReactElement<{
      readonly onClick?: () => void | Promise<void>;
    }>;

    await activeButton.props.onClick?.();
    expect(onConnect).toHaveBeenCalledTimes(1);
    expect(disabledButton.props.onClick).toBeUndefined();
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
      provider: "nango",
      status: "verifying",
    });
    expect(JSON.stringify(log.mock.calls)).not.toContain("conn_org_acme");
    expect(JSON.stringify(log.mock.calls)).not.toContain("connect_public");
    expect(JSON.stringify(log.mock.calls)).not.toContain("cs_org_acme");
  });
});
