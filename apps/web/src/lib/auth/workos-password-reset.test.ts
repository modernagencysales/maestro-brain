import type { AuthService } from "@workos/authkit-session";
import { describe, expect, it, vi } from "vitest";

import {
  handlePasswordResetConfirmation,
  handlePasswordResetRequest,
  isPasswordResetConfirmation,
  isPasswordResetRequest,
} from "./workos-password-reset";

const service = () => {
  const createPasswordReset = vi.fn(async () => ({ id: "reset_1" }));
  const resetPassword = vi.fn(async () => ({ user: { id: "user_1" } }));
  return {
    value: {
      getWorkOS: () => ({
        userManagement: { createPasswordReset, resetPassword },
      }),
    } as unknown as AuthService<Request, Response>,
    createPasswordReset,
    resetPassword,
  };
};

const post = (path: string, body: unknown, origin = "https://app.example") =>
  new Request(`https://app.example${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: origin },
    body: JSON.stringify(body),
  });

describe("WorkOS password reset routes", () => {
  it("recognizes only same-origin reset endpoints", () => {
    expect(
      isPasswordResetRequest(
        post("/api/auth/password-reset", { email: "a@example.com" }),
      ),
    ).toBe(true);
    expect(
      isPasswordResetConfirmation(
        post("/api/auth/password-reset/confirm", {
          token: "token",
          password: "new-password",
        }),
      ),
    ).toBe(true);
    expect(
      isPasswordResetRequest(
        post(
          "/api/auth/password-reset",
          { email: "a@example.com" },
          "https://evil.example",
        ),
      ),
    ).toBe(false);
  });

  it("requests a reset without exposing whether the account exists", async () => {
    const mock = service();
    const response = await handlePasswordResetRequest(
      post("/api/auth/password-reset", { email: " Person@Example.com " }),
      mock.value,
    );

    expect(response.status).toBe(202);
    expect(mock.createPasswordReset).toHaveBeenCalledWith({
      email: "person@example.com",
    });
  });

  it("changes the password using the emailed WorkOS token", async () => {
    const mock = service();
    const response = await handlePasswordResetConfirmation(
      post("/api/auth/password-reset/confirm", {
        token: "reset-token",
        password: "new-password",
      }),
      mock.value,
    );

    expect(response.status).toBe(200);
    expect(mock.resetPassword).toHaveBeenCalledWith({
      token: "reset-token",
      newPassword: "new-password",
    });
  });

  it("returns an actionable error for an expired token", async () => {
    const mock = service();
    mock.resetPassword.mockRejectedValueOnce(new Error("expired"));
    const response = await handlePasswordResetConfirmation(
      post("/api/auth/password-reset/confirm", {
        token: "expired",
        password: "new-password",
      }),
      mock.value,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "That password reset link is invalid or expired.",
    });
  });
});
