import { describe, expect, it } from "vitest";

import { createRuntimeWorkspaceOperations } from "./workspace-operations";

const liveEnv = {
  APP_ENV: "production",
  APP_PROVIDER_MODE: "live",
  WORKOS_API_KEY: "sk_live_example",
  WORKOS_CLIENT_ID: "client_live_example",
  WORKOS_COOKIE_PASSWORD: "a".repeat(32),
  WORKOS_REDIRECT_URI: "https://app.example.com/auth/callback",
  WORKOS_LOGOUT_URI: "https://app.example.com",
  WORKOS_AUTHKIT_ISSUER: "https://api.workos.com",
  WORKOS_AUTHKIT_JWKS_URL: "https://api.workos.com/sso/jwks/org_live_example",
};

describe("runtime workspace operations", () => {
  it("fails closed for signed-out live/production auth instead of granting demo owner tenancy", async () => {
    const operations = createRuntimeWorkspaceOperations({
      authSnapshot: { status: "signedOut" },
      env: liveEnv,
    });

    await expect(operations.loadWorkspaces()).rejects.toThrow(
      "Live workspace operations require authorized Confect workspace refs.",
    );
  });

  it("uses fake owner tenancy only for explicit fake/local/build-safe mode", async () => {
    const operations = createRuntimeWorkspaceOperations({
      authSnapshot: { status: "signedOut" },
      env: { APP_PROVIDER_MODE: "fake", APP_ENV: "development" },
    });

    await expect(operations.loadWorkspaces()).resolves.toEqual([
      expect.objectContaining({
        role: "owner",
        workspaceId: "workspace_template_demo",
      }),
    ]);
  });
});
