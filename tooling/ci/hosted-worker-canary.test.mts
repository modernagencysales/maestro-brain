import { describe, expect, it, vi } from "vitest";
import { runHostedWorkerCanary } from "./hosted-worker-canary.mts";

const html = (title = "Maestro Brain", asset = "/assets/app.js") =>
  `<!doctype html><html lang="en"><head><title>${title}</title><script src="${asset}"></script></head></html>`;

describe("hosted Worker canary", () => {
  it("proves the public shell routes and one immutable built asset", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = new URL(String(input));
      return url.pathname.startsWith("/assets/")
        ? new Response("export default true", {
            status: 200,
            headers: { "content-type": "text/javascript" },
          })
        : new Response(html(url.pathname === "/login" ? "Login" : undefined), {
            status: 200,
            headers: { "content-type": "text/html; charset=utf-8" },
          });
    });

    await expect(
      runHostedWorkerCanary({
        hostedUrl: "https://brain.example.test/",
        fetchImpl,
      }),
    ).resolves.toEqual({
      ok: true,
      origin: "https://brain.example.test",
      routes: ["/", "/login", "/brain"],
      assetPath: "/assets/app.js",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(4);
  });

  it.each([
    ["an HTTP failure", new Response("no", { status: 500 })],
    [
      "the wrong product shell",
      new Response('<html lang="en"><title>Old UI</title></html>', {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ],
    [
      "an embedded runtime error",
      new Response(`${html()}<pre>HTTPError</pre>`, {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ],
  ])("fails closed for %s", async (_label, response) => {
    await expect(
      runHostedWorkerCanary({
        hostedUrl: "https://brain.example.test/",
        fetchImpl: vi.fn<typeof fetch>(async () => response.clone()),
      }),
    ).rejects.toThrow();
  });
});
