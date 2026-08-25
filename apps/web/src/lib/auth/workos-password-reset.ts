import { createAuthService, type AuthService } from "@workos/authkit-session";

import { StartCookieSessionStorage } from "./workos-cookie-session-storage";

const jsonResponse = (body: unknown, status: number) =>
  Response.json(body, { status });

const createService = () =>
  createAuthService<Request, Response>({
    sessionStorageFactory: (config) => new StartCookieSessionStorage(config),
  });

const isSameOriginPost = (request: Request) => {
  const url = new URL(request.url);
  return (
    request.method === "POST" && request.headers.get("Origin") === url.origin
  );
};

export const isPasswordResetRequest = (request: Request): boolean =>
  isSameOriginPost(request) &&
  new URL(request.url).pathname.endsWith("/password-reset");

export const isPasswordResetConfirmation = (request: Request): boolean =>
  isSameOriginPost(request) &&
  new URL(request.url).pathname.endsWith("/password-reset/confirm");

export const handlePasswordResetRequest = async (
  request: Request,
  service: AuthService<Request, Response> = createService(),
) => {
  const body: unknown = await request.json().catch(() => null);
  const email =
    typeof body === "object" &&
    body !== null &&
    "email" in body &&
    typeof body.email === "string"
      ? body.email.trim().toLowerCase()
      : "";
  if (!email) return jsonResponse({ error: "A valid email is required." }, 400);

  try {
    await service.getWorkOS().userManagement.createPasswordReset({ email });
  } catch {
    // Do not reveal whether an account exists. WorkOS may reject unknown users,
    // but the public response remains identical to the successful case.
  }
  return jsonResponse({ accepted: true }, 202);
};

export const handlePasswordResetConfirmation = async (
  request: Request,
  service: AuthService<Request, Response> = createService(),
) => {
  const body: unknown = await request.json().catch(() => null);
  const token =
    typeof body === "object" &&
    body !== null &&
    "token" in body &&
    typeof body.token === "string"
      ? body.token.trim()
      : "";
  const password =
    typeof body === "object" &&
    body !== null &&
    "password" in body &&
    typeof body.password === "string"
      ? body.password
      : "";
  if (!token || !password)
    return jsonResponse(
      { error: "A reset token and new password are required." },
      400,
    );

  try {
    await service.getWorkOS().userManagement.resetPassword({
      token,
      newPassword: password,
    });
    return jsonResponse({ updated: true }, 200);
  } catch {
    return jsonResponse(
      { error: "That password reset link is invalid or expired." },
      400,
    );
  }
};
