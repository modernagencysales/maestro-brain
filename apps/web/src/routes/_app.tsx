import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";

import {
  isFixtureAuthRuntime,
  requireAuthenticatedRoute,
} from "#lib/auth/route-auth";
import {
  ensureAuthenticatedUserProvisioned,
  hasLegacyUppercaseWorkspaceSlug,
} from "#lib/auth/ensure-provisioned";

export const Route = createFileRoute("/_app")({
  // The purchased Saas UI Pro shell is client-authored and its Resizer reads
  // browser globals while rendering. Keep the literal shell out of TanStack SSR.
  ssr: false,
  beforeLoad: async ({ context, location }) => {
    const { auth } = requireAuthenticatedRoute({
      auth: context.auth,
      location,
    });
    if (!isFixtureAuthRuntime()) {
      await ensureAuthenticatedUserProvisioned(context.convexClient, auth.user);
    }
    if (hasLegacyUppercaseWorkspaceSlug(location.pathname)) {
      throw redirect({ to: "/" });
    }
  },
  staleTime: 5 * 60 * 1000, // 5 minutes
  // pendingComponent: AppLoader,
  component: () => {
    return <Outlet />;
  },
});
