import {
  createAuthService,
  getConfig,
  selectStalePKCEVerifierCookieNames,
  type AuthService,
} from "@workos/authkit-session";
import { handleCallbackRoute } from "@workos/authkit-tanstack-react-start";

import { fixtureAuthRedirect } from "./fixture-auth";
import { guardedCallback } from "./workos-callback";
import { safeReturnPath } from "./return-path";
import { isFixtureAuthRuntime } from "./route-auth";
import {
  appendHeaderBag,
  appendResponseCookies,
  parseCookieHeader,
  StartCookieSessionStorage,
} from "./workos-cookie-session-storage";

export async function appendStaleVerifierDeletes(input: {
  readonly auth: AuthService<Request, Response>;
  readonly request: Request;
  readonly keepCookieName: string;
  readonly headers: Headers;
  readonly redirectUri: string;
}) {
  const stale = selectStalePKCEVerifierCookieNames(
    Object.keys(parseCookieHeader(input.request.headers.get("cookie") ?? "")),
    { keep: input.keepCookieName },
  );
  await Promise.all(
    stale.map(async (cookieName) => {
      try {
        const result = await input.auth.clearPendingVerifierByName(undefined, {
          cookieName,
          redirectUri: input.redirectUri,
        });
        appendResponseCookies(input.headers, result.response);
        appendHeaderBag(input.headers, result.headers);
      } catch {
        // Stale verifier cleanup is best effort; the current flow must proceed.
      }
    }),
  );
}

type AuthEntryKind = "sign-in" | "sign-up";

export const createWorkosCallbackHandler = () =>
  guardedCallback(handleCallbackRoute());

export function createAuthEntryHandler(kind: AuthEntryKind) {
  return async ({ request }: { readonly request: Request }) => {
    if (isFixtureAuthRuntime()) return fixtureAuthRedirect(request);
    const auth = createAuthService<Request, Response>({
      sessionStorageFactory: (config) => new StartCookieSessionStorage(config),
    });
    const options = {
      redirectUri: getConfig("redirectUri"),
      returnPathname: safeReturnPath(
        new URL(request.url).searchParams.get("returnPathname"),
      ),
    };
    const result =
      kind === "sign-in"
        ? await auth.createSignIn(undefined, options)
        : await auth.createSignUp(undefined, options);
    const headers = new Headers({ Location: result.url });
    appendResponseCookies(headers, result.response);
    appendHeaderBag(headers, result.headers);
    await appendStaleVerifierDeletes({
      auth,
      request,
      keepCookieName: result.cookieName,
      headers,
      redirectUri: options.redirectUri,
    });
    return new Response(null, { status: 307, headers });
  };
}
