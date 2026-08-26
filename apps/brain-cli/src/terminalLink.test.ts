import { describe, expect, it } from "vitest";
import { linkTerminal } from "./terminalLink.js";

describe("terminal browser linking", () => {
  it("uses loopback, strong state, and validates the returned origin", async () => {
    let opened: URL | undefined;
    const linked = linkTerminal({
      siteOrigin: "https://app.example.test",
      apiOrigin: "https://api.example.test",
      platform: "linux",
      open: (url) => {
        opened = new URL(url);
        const callback = new URL(opened.searchParams.get("callback") as string);
        callback.searchParams.set(
          "state",
          opened.searchParams.get("state") as string,
        );
        callback.searchParams.set("key", "linked-key");
        callback.searchParams.set("workspace", "apero");
        callback.searchParams.set("origin", "https://api.example.test");
        void fetch(callback);
      },
      timeoutMs: 2_000,
    });
    await expect(linked).resolves.toEqual({
      key: "linked-key",
      workspace: "apero",
      origin: "https://api.example.test",
    });
    expect(opened?.pathname).toBe("/terminal-link");
    expect(opened?.searchParams.get("state")?.length).toBeGreaterThanOrEqual(
      16,
    );
    expect(opened?.searchParams.get("callback")).toMatch(
      /^http:\/\/127\.0\.0\.1:\d+\/callback$/u,
    );
  });
});
