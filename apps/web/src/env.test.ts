import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isReferenceRoutesEnabled,
  requireBuildWebEnv,
  resolveWebEnv,
  WebEnvConfigError,
} from "./env";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("web environment", () => {
  it("requires a configured Convex URL for Vite builds", () => {
    expect(() => requireBuildWebEnv("build", {})).toThrow(WebEnvConfigError);
    expect(() =>
      requireBuildWebEnv("build", { VITE_CONVEX_URL: "   " }),
    ).toThrow(WebEnvConfigError);
    expect(() =>
      requireBuildWebEnv("build", {
        VITE_CONVEX_URL: "https://perfect-sparrow-808.convex.cloud",
      }),
    ).not.toThrow();
    expect(() => requireBuildWebEnv("serve", {})).not.toThrow();
  });

  it("uses a fake-safe Convex fallback when no URL is configured", () => {
    expect(resolveWebEnv({})).toEqual({
      env: { VITE_CONVEX_URL: "https://fake-template-123.convex.cloud" },
      convexConfigured: false,
    });
    expect(resolveWebEnv({ VITE_CONVEX_URL: "   " })).toEqual({
      env: { VITE_CONVEX_URL: "https://fake-template-123.convex.cloud" },
      convexConfigured: false,
    });
  });

  it("accepts exact configured Convex URLs", () => {
    expect(
      resolveWebEnv({
        VITE_CONVEX_URL: "https://acme-demo.example.test/convex",
      }),
    ).toEqual({
      env: { VITE_CONVEX_URL: "https://acme-demo.example.test/convex" },
      convexConfigured: true,
    });
  });

  it("rejects whitespace-contaminated configured URLs by env name", () => {
    expect(() =>
      resolveWebEnv({
        VITE_CONVEX_URL: " https://acme-demo.example.test/convex ",
      }),
    ).toThrow(WebEnvConfigError);

    try {
      resolveWebEnv({
        VITE_CONVEX_URL: " https://acme-demo.example.test/convex ",
      });
      throw new Error("expected resolveWebEnv to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(WebEnvConfigError);
      expect(error).toMatchObject({ invalidEnv: ["VITE_CONVEX_URL"] });
      expect(JSON.stringify(error)).not.toContain("acme-demo");
    }
  });

  it("enables reference routes only for the explicit non-production flag", () => {
    vi.stubEnv("PROD", false);
    vi.stubEnv("VITE_ENABLE_REFERENCE_ROUTES", "true");

    expect(isReferenceRoutesEnabled()).toBe(true);

    vi.stubEnv("VITE_ENABLE_REFERENCE_ROUTES", "false");
    expect(isReferenceRoutesEnabled()).toBe(false);

    vi.stubEnv("VITE_ENABLE_REFERENCE_ROUTES", undefined);
    expect(isReferenceRoutesEnabled()).toBe(false);
  });

  it("keeps reference routes disabled in production even when flagged", () => {
    vi.stubEnv("PROD", true);
    vi.stubEnv("VITE_ENABLE_REFERENCE_ROUTES", "true");

    expect(isReferenceRoutesEnabled()).toBe(false);
  });
});
