import { describe, expect, it, vi } from "vitest";

import { NangoConnectCancelled, openNangoConnect } from "./connectBrowser";

const frontendFor = (event: unknown) => {
  const open = vi.fn();
  const close = vi.fn();
  const constructor = class {
    constructor(config: { readonly connectSessionToken: string }) {
      void config;
    }

    openConnectUI(input: { readonly onEvent: (value: unknown) => void }) {
      open.mockImplementation(() => input.onEvent(event));
      return { open, close };
    }
  };
  return { constructor, open, close };
};

describe("Nango browser connect", () => {
  it("opens Connect UI and returns the authorized connection", async () => {
    const frontend = frontendFor({
      type: "connect",
      payload: { connectionId: "slack_connection_1" },
    });

    await expect(
      openNangoConnect({
        connectSessionToken: "connect_session_token",
        NangoFrontend: frontend.constructor,
      }),
    ).resolves.toEqual({ connectionId: "slack_connection_1" });
    expect(frontend.open).toHaveBeenCalledOnce();
    expect(frontend.close).toHaveBeenCalledOnce();
  });

  it("treats closing Connect UI as cancellation", async () => {
    const frontend = frontendFor({ type: "close" });

    await expect(
      openNangoConnect({
        connectSessionToken: "connect_session_token",
        NangoFrontend: frontend.constructor,
      }),
    ).rejects.toBeInstanceOf(NangoConnectCancelled);
    expect(frontend.close).toHaveBeenCalledOnce();
  });

  it("surfaces a Nango authorization error", async () => {
    const frontend = frontendFor({
      type: "error",
      payload: { errorType: "unknown_error", errorMessage: "failed" },
    });

    await expect(
      openNangoConnect({
        connectSessionToken: "connect_session_token",
        NangoFrontend: frontend.constructor,
      }),
    ).rejects.toThrow("Unable to complete Slack authorization.");
  });
});
