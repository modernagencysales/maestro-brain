import { createFileRoute, redirect } from "@tanstack/react-router";

import { DefaultLoader } from "#components/default-loader";
import { getLastUsedWorkspace } from "#lib/last-used-workspace";
import { selectInitialWorkspace } from "#lib/root-index-navigation";
import {
  getFunctionReference,
  templateConfectRefs,
} from "@maestro-template/convex/refs";
import { isFixtureAuthRuntime } from "#lib/auth/route-auth";

export const Route = createFileRoute("/_app/")({
  beforeLoad: async ({ context }) => {
    if (isFixtureAuthRuntime()) {
      throw redirect({
        to: "/$workspace",
        params: { workspace: "awesome-inc" },
      });
    }
    if (!context.auth?.user) {
      throw redirect({
        to: "/login",
      });
    }

    await context.convexClient.mutation(
      getFunctionReference(
        templateConfectRefs.public.access.provisioning.ensureProvisioned,
      ) as never,
      sessionEmailArgs(context.auth.user) as never,
    );

    const user = await context.trpc.auth.me.ensureData().catch(() => null);

    if (!user) {
      throw redirect({
        to: "/login",
      });
    }

    const workspace = selectInitialWorkspace(
      user.workspaces,
      getLastUsedWorkspace(),
    );

    if (!workspace) {
      throw redirect({
        to: "/getting-started",
      });
    }

    throw redirect({
      to: "/$workspace",
      params: {
        workspace: workspace.slug,
      },
    });
  },
  pendingComponent: DefaultLoader,
  component: () => null,
});

const sessionEmailArgs = (user: unknown) => {
  if (typeof user !== "object" || user === null || !("email" in user)) {
    return {};
  }
  const email = user.email;
  return typeof email === "string" && email.trim().length > 0
    ? { sessionEmail: email }
    : {};
};
