import { ConvexProvider, type ConvexReactClient } from "convex/react";
import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import { AuthKitProvider } from "@workos/authkit-tanstack-react-start/client";
import type { ConvexQueryClient } from "@convex-dev/react-query";
import type { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TemplateToastProvider } from "@maestro-template/ui";

import {
  createBrowserWorkspaceStorage,
  WorkspaceProvider,
} from "../providers/workspace";
import { createFakeWorkspaceOperations } from "../providers/workspace-operations";
import { PostHogWebProvider } from "../providers/posthog";
import { WebRouteUxBoundary } from "../navigation/route-ux-boundary";
import appCssUrl from "../index.css?url";
import notionCssUrl from "../notion.css?url";
import xyflowCssUrl from "@xyflow/react/dist/style.css?url";

export type RouterContext = {
  readonly queryClient: QueryClient;
  readonly convexClient: ConvexReactClient;
  readonly convexQueryClient: ConvexQueryClient;
};

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      {
        name: "viewport",
        content: "width=device-width, initial-scale=1, viewport-fit=cover",
      },
      { title: "Maestro Template" },
      {
        name: "description",
        content:
          "Private app factory for B2B AI Brain, workflow, and agent software.",
      },
      { name: "application-name", content: "Maestro Template" },
    ],
    links: [
      { rel: "stylesheet", href: notionCssUrl },
      { rel: "stylesheet", href: xyflowCssUrl },
      { rel: "stylesheet", href: appCssUrl },
    ],
  }),
  component: RootComponent,
});

const fakeInitialAuth = { user: null } as const;

function ConvexProviderWithAuth({
  children,
  client,
}: {
  readonly children: ReactNode;
  readonly client: ConvexReactClient;
}) {
  return <ConvexProvider client={client}>{children}</ConvexProvider>;
}

function RootComponent() {
  const { convexClient } = Route.useRouteContext();
  const location = useRouterState({ select: (state) => state.location });

  return (
    <AuthKitProvider initialAuth={fakeInitialAuth}>
      <ConvexProviderWithAuth client={convexClient}>
        <WorkspaceProvider
          operations={createFakeWorkspaceOperations()}
          storage={createBrowserWorkspaceStorage()}
        >
          <PostHogWebProvider>
            <RootDocument>
              <WebRouteUxBoundary
                href={location.href}
                pathname={location.pathname}
              >
                <TemplateToastProvider>
                  <Outlet />
                </TemplateToastProvider>
              </WebRouteUxBoundary>
            </RootDocument>
          </PostHogWebProvider>
        </WorkspaceProvider>
      </ConvexProviderWithAuth>
    </AuthKitProvider>
  );
}

function RootDocument({ children }: { readonly children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
