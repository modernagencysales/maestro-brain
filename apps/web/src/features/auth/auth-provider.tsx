import React from "react";
import {
  AuthProvider as BaseAuthProvider,
  type AuthProviderProps,
} from "@saas-ui/auth-provider";
import { isFixtureAuthRuntime } from "#lib/auth/route-auth";
import { fixtureAuthService } from "#lib/auth/fixture-auth";

type StarterUser = {
  readonly id: string;
  readonly name?: string;
  readonly email?: string;
  readonly image?: string | null;
};

export class EmailVerificationRequiredError extends Error {
  readonly userId: string;

  constructor(message: string, userId: string) {
    super(message);
    this.name = "EmailVerificationRequiredError";
    this.userId = userId;
  }
}

export const client = {
  getSession: async () => {
    const response = await fetch("/api/auth/session");
    if (!response.ok) return { data: null };
    return (await response.json()) as {
      data: { session: { id: string }; user: StarterUser } | null;
    };
  },
};

const redirectToAuth = (path: string) => {
  window.location.assign(
    `/api/auth/${path}?returnPathname=${encodeURIComponent(window.location.pathname)}`,
  );
  return null;
};

const passwordAuth = async (
  path: "sign-in" | "sign-up",
  params: unknown,
): Promise<StarterUser | null> => {
  if (typeof params !== "object" || params === null) {
    throw new Error("Email and password are required.");
  }

  if (
    "provider" in params &&
    typeof params.provider === "string" &&
    params.provider.length > 0
  ) {
    redirectToAuth(path);
    return null;
  }

  const response = await fetch(`/api/auth/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  });
  const payload: unknown = await response.json().catch(() => null);
  if (
    response.status === 202 &&
    typeof payload === "object" &&
    payload !== null &&
    "verificationRequired" in payload &&
    payload.verificationRequired === true
  ) {
    const message =
      "message" in payload && typeof payload.message === "string"
        ? payload.message
        : "Check your email to verify your account, then log in.";
    const userId =
      "userId" in payload && typeof payload.userId === "string"
        ? payload.userId
        : "";
    if (!userId)
      throw new Error("WorkOS did not return an email verification session.");
    throw new EmailVerificationRequiredError(message, userId);
  }
  if (!response.ok) {
    if (
      response.status === 409 &&
      typeof payload === "object" &&
      payload !== null &&
      "fallback" in payload &&
      (payload.fallback === "hosted" || payload.fallback === "hosted-sign-in")
    ) {
      redirectToAuth(payload.fallback === "hosted-sign-in" ? "sign-in" : path);
      return null;
    }
    const message =
      typeof payload === "object" &&
      payload !== null &&
      "error" in payload &&
      typeof payload.error === "string"
        ? payload.error
        : "Authentication failed. Please try again.";
    throw new Error(message);
  }
  if (
    typeof payload !== "object" ||
    payload === null ||
    !("user" in payload) ||
    typeof payload.user !== "object" ||
    payload.user === null ||
    !("id" in payload.user) ||
    typeof payload.user.id !== "string"
  ) {
    throw new Error("Authentication succeeded without a valid user session.");
  }
  return payload.user as StarterUser;
};

export const verifySignupEmail = (params: {
  readonly email: string;
  readonly password: string;
  readonly userId: string;
  readonly verificationCode: string;
}) => passwordAuth("sign-up", params);

export const authService: Pick<
  AuthProviderProps,
  "onLoadUser" | "onLogin" | "onSignup" | "onLogout"
> = {
  onLoadUser: async () => (await client.getSession()).data?.user ?? null,
  onLogin: async (params) => passwordAuth("sign-in", params),
  onSignup: async (params) => passwordAuth("sign-up", params),
  onLogout: async () => {
    const form = document.createElement("form");
    form.method = "post";
    form.action = "/api/auth/logout";
    document.body.append(form);
    form.submit();
  },
};

export function AuthProvider(props: { children: React.ReactNode }) {
  const service = isFixtureAuthRuntime() ? fixtureAuthService : authService;
  return <BaseAuthProvider {...service}>{props.children}</BaseAuthProvider>;
}
