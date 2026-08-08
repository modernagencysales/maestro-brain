import { ConvexProviderWithAuth, type ConvexReactClient } from "convex/react";
import type { ComponentType, ReactNode } from "react";

import type { ClientAuthSnapshot } from "./authkit-server";

type AuthKitInitialAuth =
  | { readonly user: null }
  | {
      readonly user: { readonly id: string; readonly email: string };
      readonly sessionId: string;
      readonly organizationId: string;
    };

type AuthKitProviderComponent = ComponentType<{
  readonly children: ReactNode;
  readonly initialAuth: AuthKitInitialAuth;
}>;

type WorkosConvexAuthState = {
  readonly user: { readonly id?: string } | null;
  readonly loading: boolean;
  readonly token: {
    readonly loading: boolean;
    readonly accessToken: string | undefined;
    readonly getAccessToken: () => Promise<string | undefined>;
  };
};

const convexTokenFetchers = new WeakMap<
  WorkosConvexAuthState["token"]["getAccessToken"],
  () => Promise<string | null>
>();

const convexTokenFetcherFor = (
  getAccessToken: WorkosConvexAuthState["token"]["getAccessToken"],
) => {
  const existing = convexTokenFetchers.get(getAccessToken);
  if (existing !== undefined) return existing;
  const fetcher = async () => (await getAccessToken()) ?? null;
  convexTokenFetchers.set(getAccessToken, fetcher);
  return fetcher;
};

export type AuthKitClientBridge = {
  readonly AuthKitProvider: AuthKitProviderComponent;
  readonly useAuth: () => {
    readonly user: { readonly id?: string } | null;
    readonly loading: boolean;
  };
  readonly useAccessToken: () => WorkosConvexAuthState["token"];
};

export const authSnapshotToInitialAuth = (
  snapshot: ClientAuthSnapshot,
): AuthKitInitialAuth => {
  if (snapshot.status === "signedOut") return { user: null };

  return {
    user: {
      id: snapshot.subject,
      email: snapshot.email,
    },
    sessionId: snapshot.sessionId,
    organizationId: snapshot.organizationId,
  };
};

export const createWorkosConvexAuthHook = (
  useWorkosState: () => WorkosConvexAuthState,
) =>
  function useWorkosConvexAuth() {
    const state = useWorkosState();

    return {
      isLoading: state.loading || state.token.loading,
      isAuthenticated: Boolean(state.user),
      fetchAccessToken: convexTokenFetcherFor(state.token.getAccessToken),
    };
  };

export const createAuthKitProviderWithConvexProviderWithAuth = ({
  AuthKitProvider,
  useAccessToken,
  useAuth,
}: AuthKitClientBridge) => {
  const useWorkosConvexAuth = createWorkosConvexAuthHook(() => {
    const auth = useAuth();
    const token = useAccessToken();

    return {
      user: auth.user,
      loading: auth.loading,
      token,
    };
  });

  return function AuthKitProviderWithConvexProviderWithAuth({
    children,
    client,
    initialAuthSnapshot,
  }: {
    readonly children: ReactNode;
    readonly client: ConvexReactClient;
    readonly initialAuthSnapshot: ClientAuthSnapshot;
  }) {
    return (
      <AuthKitProvider
        initialAuth={authSnapshotToInitialAuth(initialAuthSnapshot)}
      >
        <ConvexProviderWithAuth client={client} useAuth={useWorkosConvexAuth}>
          {children}
        </ConvexProviderWithAuth>
      </AuthKitProvider>
    );
  };
};
