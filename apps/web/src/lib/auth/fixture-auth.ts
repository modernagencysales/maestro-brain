import type { AuthProviderProps } from "@saas-ui/auth-provider";

import { safeReturnPath } from "./return-path";

export const fixtureAuthUser = {
  id: "fixture-runtime",
  name: "Fixture Reviewer",
  email: "reviewer@maestro.local",
} as const;

export const fixtureAuthService: Pick<
  AuthProviderProps,
  "onLoadUser" | "onLogin" | "onSignup" | "onLogout"
> = {
  onLoadUser: async () => fixtureAuthUser,
  onLogin: async () => fixtureAuthUser,
  onSignup: async () => fixtureAuthUser,
  onLogout: async () => undefined,
};

export function fixtureAuthRedirect(request: Request): Response {
  const returnPath = safeReturnPath(
    new URL(request.url).searchParams.get("returnPathname"),
  );
  return new Response(null, {
    status: 307,
    headers: { Location: returnPath },
  });
}
