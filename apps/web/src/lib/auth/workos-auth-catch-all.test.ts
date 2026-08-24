import { afterEach, describe, expect, it, vi } from "vitest";

import { workosAuthCatchAllRouteOptions } from "./workos-auth-catch-all";

describe("WorkOS catch-all route adapter", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("returns an anonymous session without AuthKit in fixture mode", async () => {
    vi.stubEnv("VITE_MAESTRO_AUTH_MODE", "fixture");

    const response = await workosAuthCatchAllRouteOptions.server.handlers.GET({
      request: new Request("https://app.example/api/auth/session"),
    } as never);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ data: null });
  });

  it("rejects non-logout POST requests", async () => {
    const response = await workosAuthCatchAllRouteOptions.server.handlers.POST({
      request: new Request("https://app.example/api/auth/session", {
        method: "POST",
        headers: { Origin: "https://app.example" },
      }),
    } as never);

    expect(response.status).toBe(403);
  });
});
