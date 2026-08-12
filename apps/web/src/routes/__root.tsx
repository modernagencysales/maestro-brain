import {
  createRootRouteWithContext,
  HeadContent,
  Outlet,
  redirect,
  Scripts,
  useRouterState,
} from "@tanstack/react-router";
import type { ConvexQueryClient } from "@convex-dev/react-query";
import type { ConvexReactClient } from "convex/react";
import type { QueryClient } from "@tanstack/react-query";
import { useRef, type ReactNode } from "react";
import { TemplateToastProvider } from "@maestro-template/ui";

import { createAuthKitProviderWithConvexProviderWithAuth } from "../auth/authkit-client";
import type { SafeClientRuntime } from "../auth/authkit-server";
import { workosAuthKitClientBridge } from "../auth/workos-client-runtime";
import { loadSafeClientRuntime } from "../auth/safe-client-runtime";
import { AppProvider } from "../features/common/providers/app-provider";
import {
  createBrowserWorkspaceStorage,
  WorkspaceProvider,
} from "../providers/workspace";
import {
  useTemplateMutation,
  useTemplateQuery,
} from "../adapters/confect-state";
import {
  createWorkspaceLiveRefs,
  isWorkspaceListPending,
  reuseRuntimeWorkspaceOperations,
  type RuntimeWorkspaceOperationsCache,
} from "../providers/workspace-operations";
import { PostHogWebProvider } from "../providers/posthog";
import { CookieConsentBoundary } from "../providers/cookie-consent";
import { WebRouteUxBoundary } from "../navigation/route-ux-boundary";
import { buildTemplateRouteHead } from "../adapters/route-head";
import {
  AgencySetupFailure,
  AgencyWorkspaceLoading,
} from "../features/setup/agency-setup-failure";
import appCssUrl from "../index.css?url";
import xyflowCssUrl from "@xyflow/react/dist/style.css?url";

const AuthKitProviderWithConvexProviderWithAuth =
  createAuthKitProviderWithConvexProviderWithAuth(workosAuthKitClientBridge);
const browserWorkspaceStorage = createBrowserWorkspaceStorage();

export type RouterContext = {
  readonly queryClient: QueryClient;
  readonly convexClient: ConvexReactClient;
  readonly convexQueryClient: ConvexQueryClient;
};

export const Route = createRootRouteWithContext<RouterContext>()({
  head: () =>
    buildTemplateRouteHead({
      stylesheets: [
        { rel: "stylesheet", href: xyflowCssUrl },
        { rel: "stylesheet", href: appCssUrl },
      ],
    }),
  loader: async ({ location }): Promise<SafeClientRuntime> => {
    const runtime = await loadSafeClientRuntime();

    if (
      runtime.workspaceRuntimeMode !== "fake" &&
      runtime.authSnapshot.status === "signedOut"
    ) {
      throw redirect({
        href: `/sign-in?returnPathname=${encodeURIComponent(location.pathname)}`,
      });
    }

    return runtime;
  },
  component: RootComponent,
});

function RootComponent() {
  const { convexClient } = Route.useRouteContext();
  const { authSnapshot, workspaceRuntimeMode } = Route.useLoaderData();

  if (authSnapshot.status === "setupFailure") {
    return (
      <RootDocument>
        <AgencySetupFailure reason={authSnapshot.reason} />
      </RootDocument>
    );
  }

  return (
    <AuthKitProviderWithConvexProviderWithAuth
      client={convexClient}
      initialAuthSnapshot={authSnapshot}
    >
      <WorkspaceRuntimeBoundary
        authSnapshot={authSnapshot}
        workspaceRuntimeMode={workspaceRuntimeMode}
      />
    </AuthKitProviderWithConvexProviderWithAuth>
  );
}

function WorkspaceRuntimeBoundary({
  authSnapshot,
  workspaceRuntimeMode,
}: Pick<SafeClientRuntime, "authSnapshot" | "workspaceRuntimeMode">) {
  const location = useRouterState({ select: (state) => state.location });
  const liveRefs = createWorkspaceLiveRefs({
    useQuery: useTemplateQuery,
    useMutation: useTemplateMutation,
  });
  const operationsCache = useRef<RuntimeWorkspaceOperationsCache>(undefined);

  if (
    workspaceRuntimeMode !== "fake" &&
    isWorkspaceListPending(liveRefs.listResult)
  ) {
    return (
      <RootDocument>
        <AgencyWorkspaceLoading />
      </RootDocument>
    );
  }

  operationsCache.current = reuseRuntimeWorkspaceOperations(
    operationsCache.current,
    {
      authSnapshot,
      mode: workspaceRuntimeMode,
      liveRefs,
    },
  );

  return (
    <WorkspaceProvider
      operations={operationsCache.current.operations}
      storage={browserWorkspaceStorage}
    >
      <CookieConsentBoundary>
        {(analyticsConsent) => (
          <PostHogWebProvider analyticsConsent={analyticsConsent}>
            <RootDocument>
              <WebRouteUxBoundary
                href={location.href}
                pathname={location.pathname}
              >
                <AppProvider>
                  <TemplateToastProvider>
                    <Outlet />
                  </TemplateToastProvider>
                </AppProvider>
              </WebRouteUxBoundary>
            </RootDocument>
          </PostHogWebProvider>
        )}
      </CookieConsentBoundary>
    </WorkspaceProvider>
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
