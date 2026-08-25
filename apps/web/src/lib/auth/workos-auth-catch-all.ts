import { getAuthKitContext } from "@workos/authkit-tanstack-react-start";

import { isFixtureAuthRuntime } from "../../env";
import { isRecoverableAuthError } from "./workos-auth-loader";
import { handleWorkosLogout, isLogoutRequest } from "./workos-logout";
import {
  handlePasswordResetConfirmation,
  handlePasswordResetRequest,
  isPasswordResetConfirmation,
  isPasswordResetRequest,
} from "./workos-password-reset";

export const workosAuthCatchAllRouteOptions = {
  server: {
    handlers: {
      GET: async ({ request }: { request: Request }) => {
        const pathname = new URL(request.url).pathname;
        if (!pathname.endsWith("/session"))
          return new Response("Not found", { status: 404 });
        if (isFixtureAuthRuntime()) return Response.json({ data: null });
        try {
          const auth = getAuthKitContext().auth();
          if (!auth.user) return Response.json({ data: null });
          const { accessToken: _accessToken, ...safeAuth } = auth;
          void _accessToken;
          return Response.json({
            data: { session: safeAuth, user: safeAuth.user },
          });
        } catch (error) {
          if (!isRecoverableAuthError(error)) throw error;
          return Response.json({ data: null });
        }
      },
      POST: async ({ request }: { request: Request }) => {
        if (isLogoutRequest(request)) return handleWorkosLogout(request);
        if (isPasswordResetRequest(request))
          return handlePasswordResetRequest(request);
        if (isPasswordResetConfirmation(request))
          return handlePasswordResetConfirmation(request);
        return new Response("Forbidden", { status: 403 });
      },
    },
  },
} as const;
