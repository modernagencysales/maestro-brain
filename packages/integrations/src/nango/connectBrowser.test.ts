import { describe, expect, it, vi } from "vitest";

import { openNangoConnect } from "./connectBrowser";

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
