import { Outlet, createFileRoute, redirect } from "@tanstack/react-router";
import { z } from "zod";

import { AppLoader } from "@workspace/ui/app-loader";

import { AuthLayout } from "#features/auth/auth-layout";
import { safeReturnPath } from "#lib/auth/return-path";

export const Route = createFileRoute("/_auth")({
  validateSearch: z.object({
    redirectTo: z.string().optional(),
  }),
  beforeLoad: ({ context, search }) => {
    if (context.auth?.user) {
      throw redirect({
        href: safeReturnPath(search.redirectTo),
      });
    }
  },
  pendingComponent: AppLoader,
  component: () => (
    <AuthLayout>
      <Outlet />
    </AuthLayout>
  ),
});
