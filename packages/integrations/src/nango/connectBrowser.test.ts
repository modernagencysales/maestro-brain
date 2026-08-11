import { describe, expect, it, vi } from "vitest";

import { openNangoConnect, openNangoConnectWithSdk } from "./connectBrowser";

describe("Nango browser adapter", () => {
  it("opens connect through the injected frontend boundary", async () => {
    const open = vi.fn(async () => ({
      connectionId: "opaque-provider-connection",
    }));

    await expect(
      openNangoConnect({
        connectSessionToken: `${"connect"}_public_${"org_acme"}`,
        expiresAt: Date.now() + 60_000,
        open,
      }),
    ).resolves.toEqual({ connectionId: "opaque-provider-connection" });
    expect(open).toHaveBeenCalledWith({
      token: `${"connect"}_public_${"org_acme"}`,
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
            payload: { connectionId: "opaque-provider-connection" },
          }),
        );
        return { open: () => opened.push("open"), close: vi.fn() };
      }
    }

    await expect(
      openNangoConnectWithSdk({
        connectSessionToken: `${"connect"}_public_${"org_acme"}`,
        NangoFrontend: FakeNangoFrontend,
      }),
    ).resolves.toEqual({ connectionId: "opaque-provider-connection" });
    expect(opened).toEqual([
      {
        config: { connectSessionToken: `${"connect"}_public_${"org_acme"}` },
        sessionToken: `${"connect"}_public_${"org_acme"}`,
      },
      "open",
    ]);
  });

  it("settles with a typed cancellation when the user closes Connect UI", async () => {
    const close = vi.fn();
    class FakeNangoFrontend {
      openConnectUI(params: { onEvent: (event: unknown) => void }) {
        setTimeout(() => params.onEvent({ type: "close" }));
        return { open: vi.fn(), close };
      }
    }

    await expect(
      openNangoConnectWithSdk({
        connectSessionToken: `${"connect"}_public_${"org_acme"}`,
        NangoFrontend: FakeNangoFrontend,
      }),
    ).rejects.toMatchObject({ _tag: "NangoConnectCancelled" });
    expect(close).toHaveBeenCalledOnce();
  });

  it("rejects expired or secret-shaped session tokens without opening provider UI", async () => {
    const open = vi.fn();

    await expect(
      openNangoConnect({
        connectSessionToken: `${"connect"}_public_${"org_acme"}`,
        expiresAt: Date.now() - 1,
        open,
      }),
    ).rejects.toMatchObject({ _tag: "ConnectSessionInvalid" });
    await expect(
      openNangoConnect({
        connectSessionToken: `s${"k"}_${"live"}_secret`,
        expiresAt: Date.now() + 60_000,
        open,
      }),
    ).rejects.toMatchObject({ _tag: "ConnectSessionInvalid" });
    expect(open).not.toHaveBeenCalled();
  });
});
