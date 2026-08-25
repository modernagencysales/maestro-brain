import {
  createAuthService,
  getConfig,
  type AuthService,
} from "@workos/authkit-session";

import { fixtureAuthUser } from "./fixture-auth";
import { isFixtureAuthRuntime } from "./route-auth";
import {
  appendHeaderBag,
  appendResponseCookies,
  StartCookieSessionStorage,
} from "./workos-cookie-session-storage";

type PasswordAuthKind = "sign-in" | "sign-up";

type PasswordCredentials = {
  readonly email: string;
  readonly password: string;
  readonly userId?: string;
  readonly verificationCode?: string;
};

const jsonResponse = (body: unknown, init?: ResponseInit) => {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  return new Response(JSON.stringify(body), { ...init, headers });
};

const parseCredentials = async (
  request: Request,
): Promise<PasswordCredentials | null> => {
  const body: unknown = await request.json().catch(() => null);
  if (typeof body !== "object" || body === null) return null;
  if (!("email" in body) || !("password" in body)) return null;
  if (typeof body.email !== "string" || typeof body.password !== "string")
    return null;

  const email = body.email.trim().toLowerCase();
  if (!email || !body.password) return null;
  const userId =
    "userId" in body && typeof body.userId === "string"
      ? body.userId.trim()
      : "";
  const verificationCode =
    "verificationCode" in body && typeof body.verificationCode === "string"
      ? body.verificationCode.trim()
      : "";
  if ((userId && !verificationCode) || (!userId && verificationCode))
    return null;
  return {
    email,
    password: body.password,
    ...(userId && verificationCode ? { userId, verificationCode } : {}),
  };
};

const publicUser = (user: {
  readonly id: string;
  readonly email: string;
  readonly name?: string | null;
  readonly profilePictureUrl?: string | null;
}) => ({
  id: user.id,
  email: user.email,
  ...(user.name ? { name: user.name } : {}),
  ...(user.profilePictureUrl ? { image: user.profilePictureUrl } : {}),
});

const authError = (error: unknown, kind: PasswordAuthKind) => {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String(error.code)
      : "";

  if (code === "email_verification_required") {
    if (kind === "sign-up") {
      return jsonResponse(
        {
          verificationRequired: true,
          message:
            "Verify your email address using the message from WorkOS, then log in.",
        },
        { status: 202 },
      );
    }

    return jsonResponse(
      {
        error:
          "Verify your email address using the message from WorkOS, then log in.",
      },
      { status: 403 },
    );
  }

  if (code === "organization_selection_required" || code === "sso_required") {
    return jsonResponse(
      {
        error: "Continue with your company sign-in method.",
        fallback: "hosted",
      },
      { status: 409 },
    );
  }

  // WorkOS uses 404 for an unknown account. Returning a route-level 404 makes
  // TanStack render the application not-found document instead of preserving
  // this JSON API response, so credential failures use auth-specific statuses.
  const status =
    kind === "sign-in"
      ? 401
      : typeof error === "object" &&
          error !== null &&
          "status" in error &&
          error.status === 409
        ? 409
        : 400;

  return jsonResponse(
    {
      error:
        kind === "sign-in"
          ? "The email or password is incorrect."
          : "We could not create that account. It may already exist.",
    },
    { status },
  );
};

const verificationPendingResponse = (userId: string) =>
  jsonResponse(
    {
      verificationRequired: true,
      userId,
      message: "Enter the verification code WorkOS sent to your email.",
    },
    { status: 202 },
  );

const createService = () =>
  createAuthService<Request, Response>({
    sessionStorageFactory: (config) => new StartCookieSessionStorage(config),
  });

export function createPasswordAuthHandler(
  kind: PasswordAuthKind,
  service: AuthService<Request, Response> = createService(),
) {
  return async ({ request }: { readonly request: Request }) => {
    const credentials = await parseCredentials(request);
    if (!credentials)
      return jsonResponse(
        { error: "Email and password are required." },
        {
          status: 400,
        },
      );

    if (isFixtureAuthRuntime())
      return jsonResponse({ user: fixtureAuthUser }, { status: 200 });

    let existingUser = false;
    let verificationUserId = credentials.userId;
    const isVerificationAttempt = Boolean(
      credentials.userId && credentials.verificationCode,
    );
    try {
      const workos = service.getWorkOS();
      if (
        kind === "sign-up" &&
        credentials.userId &&
        credentials.verificationCode
      ) {
        await workos.userManagement.verifyEmail({
          userId: credentials.userId,
          code: credentials.verificationCode,
        });
      } else if (kind === "sign-up") {
        const matches = await workos.userManagement.listUsers({
          email: credentials.email,
          limit: 1,
        });
        const matchingUser = matches.data.find(
          (user) => user.email.toLowerCase() === credentials.email,
        );
        existingUser = Boolean(matchingUser);
        verificationUserId = matchingUser?.id;
        if (!existingUser) {
          const created = await workos.userManagement.createUser({
            email: credentials.email,
            password: credentials.password,
          });
          verificationUserId = created.id;
        }
      }

      const result = await workos.userManagement.authenticateWithPassword({
        ...credentials,
        clientId: getConfig("clientId"),
        session: {
          sealSession: true,
          cookiePassword: getConfig("cookiePassword"),
        },
      });
      if (!result.sealedSession)
        throw new Error("WorkOS did not return a sealed session");

      const saved = await service.saveSession(undefined, result.sealedSession);
      const headers = new Headers();
      appendResponseCookies(headers, saved.response);
      appendHeaderBag(headers, saved.headers);

      return jsonResponse(
        { user: publicUser(result.user) },
        { status: 200, headers },
      );
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? String(error.code)
          : "";
      if (
        kind === "sign-up" &&
        code === "email_verification_required" &&
        verificationUserId
      )
        return verificationPendingResponse(verificationUserId);
      if (isVerificationAttempt)
        return jsonResponse(
          { error: "That verification code is invalid or expired." },
          { status: 400 },
        );
      if (existingUser) {
        return jsonResponse(
          {
            error: "This WorkOS account already exists. Continue to sign in.",
            fallback: "hosted-sign-in",
          },
          { status: 409 },
        );
      }
      return authError(error, kind);
    }
  };
}
