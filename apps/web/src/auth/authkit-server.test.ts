import { describe, expect, it, vi } from "vitest";

import {
  AuthConfigurationInvalid,
  buildAuthKitRuntimeConfig,
  getAuthSnapshot,
  getClientAuthSnapshot,
  getRuntimeClientAuthSnapshot,
  getSafeClientRuntime,
  toClientAuthSnapshot,
  Unauthorized,
  type WorkosServerAuth,
} from "./authkit-server";

const validLiveEnv = {
  APP_ENV: "live",
  APP_PROVIDER_MODE: "live",
  WORKOS_API_KEY: "sk_live_example",
  WORKOS_CLIENT_ID: "client_live_example",
  WORKOS_COOKIE_PASSWORD: "a".repeat(32),
  WORKOS_REDIRECT_URI: "https://app.example.com/auth/callback",
  WORKOS_LOGOUT_URI: "https://app.example.com",
  WORKOS_AUTHKIT_ISSUER: "https://api.workos.com",
  WORKOS_AUTHKIT_JWKS_URL: "https://api.workos.com/sso/jwks/org_live_example",
} as const;

const noProvision = async () => {};

describe("AuthKit server bridge", () => {
  it("returns a typed signed-out snapshot without exposing a token", async () => {
    const snapshot = await getAuthSnapshot({
      getAuth: async () => ({ user: null }),
    });

    expect(snapshot).toEqual({ status: "signedOut" });
    expect("accessToken" in snapshot).toBe(false);
  });

  it("returns an authenticated snapshot with the WorkOS access token", async () => {
    const auth = {
      user: {
        id: "user_123",
        email: "user@example.com",
      },
      sessionId: "session_123",
      organizationId: "org_123",
      accessToken: "token-redacted",
    } as WorkosServerAuth;

    await expect(
      getAuthSnapshot({ getAuth: async () => auth }),
    ).resolves.toEqual({
      status: "authenticated",
      subject: "user_123",
      email: "user@example.com",
      organizationId: "org_123",
      sessionId: "session_123",
      accessToken: "token-redacted",
    });
  });

  it("redacts access tokens from client-serialized auth snapshots", async () => {
    const auth = {
      user: {
        id: "user_123",
        email: "user@example.com",
      },
      sessionId: "session_123",
      organizationId: "org_123",
      accessToken: "token-redacted",
    } as WorkosServerAuth;

    const clientSnapshot = await getClientAuthSnapshot({
      getAuth: async () => auth,
    });

    expect(clientSnapshot).toEqual({
      status: "authenticated",
      subject: "user_123",
      email: "user@example.com",
      organizationId: "org_123",
      sessionId: "session_123",
    });
    expect(JSON.stringify(clientSnapshot)).not.toContain("token-redacted");
    expect("accessToken" in clientSnapshot).toBe(false);
  });

  it("does not call WorkOS while resolving explicit build-time fake runtime auth", async () => {
    await expect(
      getRuntimeClientAuthSnapshot({
        env: {
          APP_ENV: "build",
          APP_PROVIDER_MODE: "fake",
          NODE_ENV: "production",
        },
        getAuth: async () => {
          throw new Error("getAuth should not be called in fake mode");
        },
        provisionWorkspace: noProvision,
      }),
    ).resolves.toEqual({ status: "signedOut" });
  });

  it("returns safe runtime metadata without calling WorkOS in fake mode", async () => {
    await expect(
      getSafeClientRuntime({
        env: {
          APP_ENV: "build",
          APP_PROVIDER_MODE: "fake",
          NODE_ENV: "production",
        },
        getAuth: async () => {
          throw new Error("getAuth should not be called in fake mode");
        },
        provisionWorkspace: noProvision,
      }),
    ).resolves.toEqual({
      authSnapshot: { status: "signedOut" },
      workspaceRuntimeMode: "fake",
    });
  });

  it("returns redacted live safe runtime metadata from server auth", async () => {
    const provisionedTokens: string[] = [];
    let releaseProvisioning!: () => void;
    let markProvisioningStarted!: () => void;
    const provisioningStarted = new Promise<void>((resolve) => {
      markProvisioningStarted = resolve;
    });
    const provisioningReleased = new Promise<void>((resolve) => {
      releaseProvisioning = resolve;
    });
    const input = {
      env: validLiveEnv,
      getAuth: async () => ({
        user: { id: "user_123", email: "user@example.com" },
        sessionId: "session_123",
        organizationId: "org_123",
        accessToken: "token-redacted",
      }),
      provisionWorkspace: async (accessToken: string) => {
        provisionedTokens.push(accessToken);
        markProvisioningStarted();
        await provisioningReleased;
      },
    };

    const runtime = getSafeClientRuntime(input);
    await provisioningStarted;
    let settled = false;
    void runtime.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await Promise.resolve();
    expect(settled).toBe(false);

    releaseProvisioning();
    await expect(runtime).resolves.toEqual({
      authSnapshot: {
        status: "authenticated",
        subject: "user_123",
        email: "user@example.com",
        organizationId: "org_123",
        sessionId: "session_123",
      },
      workspaceRuntimeMode: "live",
    });
    expect(provisionedTokens).toEqual(["token-redacted"]);
  });

  it("onboards a verified organization-less user before Convex provisioning", async () => {
    const calls: string[] = [];

    await expect(
      getSafeClientRuntime({
        env: validLiveEnv,
        getAuth: async () => ({
          user: {
            id: "user_123",
            email: "tim@example.com",
            emailVerified: true,
            firstName: "Tim",
            lastName: "Keen",
          },
          sessionId: "session_123",
          accessToken: "token_without_organization",
        }),
        onboardAgency: async (onboardingUser) => {
          calls.push(`onboard:${onboardingUser.id}`);
          return {
            kind: "authenticated",
            organizationId: "org_new",
            accessToken: "token_with_organization",
          };
        },
        provisionWorkspace: async (accessToken) => {
          calls.push(`provision:${accessToken}`);
        },
      }),
    ).resolves.toEqual({
      authSnapshot: {
        status: "authenticated",
        subject: "user_123",
        email: "tim@example.com",
        organizationId: "org_new",
        sessionId: "session_123",
      },
      workspaceRuntimeMode: "live",
    });
    expect(calls).toEqual([
      "onboard:user_123",
      "provision:token_with_organization",
    ]);
  });

  it("returns a safe setup failure without provisioning a workspace", async () => {
    const provisionWorkspace = vi.fn();

    await expect(
      getSafeClientRuntime({
        env: validLiveEnv,
        getAuth: async () => ({
          user: {
            id: "user_123",
            email: "tim@example.com",
            emailVerified: true,
            firstName: "Tim",
            lastName: "Keen",
          },
          sessionId: "session_123",
          accessToken: "token_without_organization",
        }),
        onboardAgency: async () => ({
          kind: "setupFailure",
          reason: "provider_failure",
        }),
        provisionWorkspace,
      }),
    ).resolves.toEqual({
      authSnapshot: {
        status: "setupFailure",
        reason: "provider_failure",
      },
      workspaceRuntimeMode: "live",
    });
    expect(provisionWorkspace).not.toHaveBeenCalled();
  });

  it("bypasses agency onboarding for an existing organization claim", async () => {
    const onboardAgency = vi.fn();

    await getSafeClientRuntime({
      env: validLiveEnv,
      getAuth: async () => ({
        user: { id: "user_123", email: "tim@example.com" },
        sessionId: "session_123",
        organizationId: "org_existing",
        accessToken: "token_existing",
      }),
      onboardAgency,
      provisionWorkspace: noProvision,
    });

    expect(onboardAgency).not.toHaveBeenCalled();
  });

  it("fails closed when live workspace provisioning fails", async () => {
    await expect(
      getSafeClientRuntime({
        env: validLiveEnv,
        getAuth: async () => ({
          user: { id: "user_123", email: "user@example.com" },
          sessionId: "session_123",
          organizationId: "org_123",
          accessToken: "token-redacted",
        }),
        provisionWorkspace: async () => {
          throw new Error("workspace provisioning failed");
        },
      }),
    ).rejects.toThrow("workspace provisioning failed");
  });

  it("marks safe runtime metadata as test mode for test provider config", async () => {
    await expect(
      getSafeClientRuntime({
        env: { ...validLiveEnv, APP_PROVIDER_MODE: "test" },
        getAuth: async () => ({ user: null }),
        provisionWorkspace: noProvision,
      }),
    ).resolves.toEqual({
      authSnapshot: { status: "signedOut" },
      workspaceRuntimeMode: "test",
    });
  });

  it("redacts access tokens when converting existing server snapshots for clients", () => {
    const clientSnapshot = toClientAuthSnapshot({
      status: "authenticated",
      subject: "user_123",
      email: "user@example.com",
      organizationId: "org_123",
      sessionId: "session_123",
      accessToken: "token-redacted",
    });

    expect(clientSnapshot).toEqual({
      status: "authenticated",
      subject: "user_123",
      email: "user@example.com",
      organizationId: "org_123",
      sessionId: "session_123",
    });
    expect(JSON.stringify(clientSnapshot)).not.toContain("token-redacted");
  });

  it("maps malformed authenticated AuthKit responses to Unauthorized", async () => {
    await expect(
      getAuthSnapshot({
        getAuth: async () =>
          ({
            user: { id: "user_123" },
            sessionId: "session_123",
            organizationId: "org_123",
            accessToken: "token-redacted",
          }) as WorkosServerAuth,
      }),
    ).rejects.toBeInstanceOf(Unauthorized);
  });

  it("rejects missing live AuthKit configuration at startup", () => {
    expect(() =>
      buildAuthKitRuntimeConfig({
        ...validLiveEnv,
        WORKOS_AUTHKIT_JWKS_URL: undefined,
      }),
    ).toThrow(AuthConfigurationInvalid);
  });

  it("rejects whitespace-contaminated live AuthKit configuration without logging values", () => {
    try {
      buildAuthKitRuntimeConfig({
        ...validLiveEnv,
        WORKOS_CLIENT_ID: " client_live_example ",
      });
      throw new Error("expected config failure");
    } catch (error) {
      expect(error).toBeInstanceOf(AuthConfigurationInvalid);
      expect(error).toMatchObject({ invalidEnv: ["WORKOS_CLIENT_ID"] });
      expect(String(error)).not.toContain("client_live_example");
    }
  });

  it("allows explicit fake mode outside production", () => {
    expect(
      buildAuthKitRuntimeConfig({
        APP_ENV: "fake",
        APP_PROVIDER_MODE: "fake",
      }),
    ).toEqual({ mode: "fake" });
  });

  it("allows fake provider mode only for explicit web builds", () => {
    expect(
      buildAuthKitRuntimeConfig({
        APP_ENV: "build",
        NODE_ENV: "production",
        APP_PROVIDER_MODE: "fake",
      }),
    ).toEqual({ mode: "fake" });
  });

  it("prevents implicit fake mode when NODE_ENV is production", () => {
    expect(() =>
      buildAuthKitRuntimeConfig({
        NODE_ENV: "production",
        APP_PROVIDER_MODE: "fake",
      }),
    ).toThrow(AuthConfigurationInvalid);
  });

  it("prevents fake mode in production", () => {
    expect(() =>
      buildAuthKitRuntimeConfig({
        APP_ENV: "production",
        APP_PROVIDER_MODE: "fake",
      }),
    ).toThrow(AuthConfigurationInvalid);
  });
});
