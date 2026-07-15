import { describe, expect, it, vi } from "vitest";

import { openNangoConnect, openNangoConnectWithSdk } from "./connectBrowser";

describe("Nango browser adapter", () => {
  it("opens connect through the injected frontend boundary", async () => {
    const open = vi.fn(async () => ({ connectionId: "conn_org_acme" }));

    await expect(
      openNangoConnect({
        connectSessionToken: `connect_public_${"org_acme"}`,
        expiresAt: Date.now() + 60_000,
        open,
      }),
    ).resolves.toEqual({ connectionId: "conn_org_acme" });
    expect(open).toHaveBeenCalledWith({
      token: `connect_public_${"org_acme"}`,
    });
  });

  it("opens the real @nangohq/frontend Connect UI adapter and resolves only connect events", async () => {
    const opened: unknown[] = [];
    class FakeNangoFrontend {
      constructor(readonly config: unknown) {}
      openConnectUI(params: {
        sessionToken: string;
        onEvent: (event: unknown) => void;
      }) {
        opened.push({ config: this.config, sessionToken: params.sessionToken });
        setTimeout(() =>
          params.onEvent({
            type: "connect",
            payload: { connectionId: "conn_org_acme" },
          }),
        );
        return { open: () => opened.push("open"), close: vi.fn() };
      }
    }

    await expect(
      openNangoConnectWithSdk({
        connectSessionToken: `connect_public_${"org_acme"}`,
        NangoFrontend: FakeNangoFrontend,
      }),
    ).resolves.toEqual({ connectionId: "conn_org_acme" });
    expect(opened).toEqual([
      {
        config: { connectSessionToken: `connect_public_${"org_acme"}` },
        sessionToken: `connect_public_${"org_acme"}`,
      },
      "open",
    ]);
  });

  it("rejects expired or secret-shaped session tokens without opening provider UI", async () => {
    const open = vi.fn();

    await expect(
      openNangoConnect({
        connectSessionToken: `connect_public_${"org_acme"}`,
        expiresAt: Date.now() - 1,
        open,
      }),
    ).rejects.toMatchObject({ _tag: "ConnectSessionInvalid" });
    await expect(
      openNangoConnect({
        connectSessionToken: `sk_${"live"}_secret`,
        expiresAt: Date.now() + 60_000,
        open,
      }),
    ).rejects.toMatchObject({ _tag: "ConnectSessionInvalid" });
    expect(open).not.toHaveBeenCalled();
  });
});
