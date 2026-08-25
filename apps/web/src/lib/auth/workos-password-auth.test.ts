import type { AuthService } from "@workos/authkit-session";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./route-auth", () => ({
  isFixtureAuthRuntime: () => false,
}));

vi.mock("@workos/authkit-session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@workos/authkit-session")>()),
  getConfig: (key: string) =>
    key === "clientId" ? "client_test" : "cookie-password-for-tests-32-chars",
}));

import { createPasswordAuthHandler } from "./workos-password-auth";

const user = {
  id: "user_test",
  email: "person@example.com",
  name: "Test Person",
  profilePictureUrl: null,
};

const createService = () => {
  const createUser = vi.fn(async () => user);
  const listUsers = vi.fn(async () => ({ data: [] as (typeof user)[] }));
  const authenticateWithPassword = vi.fn(async () => ({
    user,
    accessToken: "access",
    refreshToken: "refresh",
    sealedSession: "sealed-session",
  }));
  const saveSession = vi.fn(async () => ({
    headers: { "Set-Cookie": "wos-session=sealed-session; HttpOnly" },
  }));
  const service = {
    getWorkOS: () => ({
      userManagement: { createUser, listUsers, authenticateWithPassword },
    }),
    saveSession,
  } as unknown as AuthService<Request, Response>;
  return {
    service,
    createUser,
    listUsers,
    authenticateWithPassword,
    saveSession,
  };
};

const request = (body: unknown) =>
  new Request("https://app.example/api/auth/sign-in", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

describe("WorkOS password auth", () => {
  beforeEach(() => vi.clearAllMocks());

  it("authenticates credentials and writes the sealed WorkOS session", async () => {
    const { service, authenticateWithPassword, saveSession } = createService();
    const response = await createPasswordAuthHandler(
      "sign-in",
      service,
    )({
      request: request({ email: " Person@Example.com ", password: "secret" }),
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      user: {
        id: "user_test",
        email: "person@example.com",
        name: "Test Person",
      },
    });
    expect(authenticateWithPassword).toHaveBeenCalledWith(
      expect.objectContaining({
        email: "person@example.com",
        password: "secret",
        clientId: "client_test",
        session: expect.objectContaining({ sealSession: true }),
      }),
    );
    expect(saveSession).toHaveBeenCalledWith(undefined, "sealed-session");
    expect(response.headers.get("Set-Cookie")).toContain("wos-session");
  });

  it("creates a WorkOS user before signing up", async () => {
    const { service, createUser } = createService();
    const response = await createPasswordAuthHandler(
      "sign-up",
      service,
    )({
      request: request({ email: "person@example.com", password: "secret" }),
    });

    expect(response.status).toBe(200);
    expect(createUser).toHaveBeenCalledWith({
      email: "person@example.com",
      password: "secret",
    });
  });

  it("treats new-account email verification as a successful pending signup", async () => {
    const { service, createUser, authenticateWithPassword } = createService();
    authenticateWithPassword.mockRejectedValueOnce({
      status: 403,
      code: "email_verification_required",
    });

    const response = await createPasswordAuthHandler(
      "sign-up",
      service,
    )({
      request: request({ email: "person@example.com", password: "secret" }),
    });

    expect(response.status).toBe(202);
    expect(createUser).toHaveBeenCalledOnce();
    expect(await response.json()).toEqual({
      verificationRequired: true,
      message:
        "Verify your email address using the message from WorkOS, then log in.",
    });
  });

  it("authenticates an existing WorkOS user when signup is retried", async () => {
    const { service, createUser, listUsers, authenticateWithPassword } =
      createService();
    listUsers.mockResolvedValueOnce({ data: [user] });

    const response = await createPasswordAuthHandler(
      "sign-up",
      service,
    )({
      request: request({ email: "person@example.com", password: "secret" }),
    });

    expect(response.status).toBe(200);
    expect(createUser).not.toHaveBeenCalled();
    expect(authenticateWithPassword).toHaveBeenCalledOnce();
  });

  it("hands an existing account with different credentials to WorkOS", async () => {
    const { service, listUsers, authenticateWithPassword } = createService();
    listUsers.mockResolvedValueOnce({ data: [user] });
    authenticateWithPassword.mockRejectedValueOnce({ status: 401 });

    const response = await createPasswordAuthHandler(
      "sign-up",
      service,
    )({
      request: request({ email: "person@example.com", password: "different" }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "This WorkOS account already exists. Continue to sign in.",
      fallback: "hosted-sign-in",
    });
  });

  it("rejects malformed credential payloads before calling WorkOS", async () => {
    const { service, authenticateWithPassword } = createService();
    const response = await createPasswordAuthHandler(
      "sign-in",
      service,
    )({
      request: request({ email: "person@example.com" }),
    });

    expect(response.status).toBe(400);
    expect(authenticateWithPassword).not.toHaveBeenCalled();
  });

  it("normalizes WorkOS unknown-user responses to an API-safe 401", async () => {
    const { service, authenticateWithPassword } = createService();
    authenticateWithPassword.mockRejectedValueOnce({ status: 404 });

    const response = await createPasswordAuthHandler(
      "sign-in",
      service,
    )({
      request: request({ email: "missing@example.com", password: "secret" }),
    });

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      error: "The email or password is incorrect.",
    });
  });

  it("marks required company auth as a hosted fallback", async () => {
    const { service, authenticateWithPassword } = createService();
    authenticateWithPassword.mockRejectedValueOnce({
      status: 400,
      code: "sso_required",
    });

    const response = await createPasswordAuthHandler(
      "sign-in",
      service,
    )({
      request: request({ email: "person@example.com", password: "secret" }),
    });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Continue with your company sign-in method.",
      fallback: "hosted",
    });
  });
});
