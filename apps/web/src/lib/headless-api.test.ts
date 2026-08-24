import { afterEach, describe, expect, it, vi } from "vitest";

import { runIsolatedHeadlessOperation } from "./headless-api";

afterEach(() => vi.unstubAllGlobals());

describe("isolated headless operation adapter", () => {
  it("returns the runtime result without owning credentials in the browser", async () => {
    const request = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            ok: true,
            operationId: "brain.pages.list",
            result: [{ _id: "page_1" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", request);

    await expect(
      runIsolatedHeadlessOperation<readonly { _id: string }[]>({
        operationId: "brain.pages.list",
      }),
    ).resolves.toEqual([{ _id: "page_1" }]);
    expect(request).toHaveBeenCalledWith(
      "/__contracts/api/brain.pages.list",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ input: {} }),
      }),
    );
    expect(JSON.stringify(request.mock.calls)).not.toContain("authorization");
  });

  it("surfaces typed runtime failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              ok: false,
              error: { _tag: "StaleRevision", message: "Page changed." },
            }),
            { status: 409, headers: { "content-type": "application/json" } },
          ),
      ),
    );

    await expect(
      runIsolatedHeadlessOperation({
        operationId: "brain.pages.updateMarkdown",
      }),
    ).rejects.toThrow("StaleRevision: Page changed.");
  });
});
