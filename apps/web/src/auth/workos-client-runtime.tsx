import {
  AuthKitProvider as WorkosAuthKitProvider,
  useAccessToken,
  useAuth,
  type AuthKitProviderProps,
} from "@workos/authkit-tanstack-react-start/client";

import type { AuthKitClientBridge } from "./authkit-client";

const WorkosAuthKitProviderBoundary: AuthKitClientBridge["AuthKitProvider"] = ({
  children,
  initialAuth,
}) => {
  const workosInitialAuth = initialAuth as NonNullable<
    AuthKitProviderProps["initialAuth"]
  >;

  return (
    <WorkosAuthKitProvider initialAuth={workosInitialAuth}>
      {children}
    </WorkosAuthKitProvider>
  );
};

export const workosAuthKitClientBridge: AuthKitClientBridge = {
  AuthKitProvider: WorkosAuthKitProviderBoundary,
  useAccessToken,
  useAuth,
};
