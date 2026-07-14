import { getAuth } from "@workos/authkit-tanstack-react-start";
import { authkitMiddleware } from "@workos/authkit-tanstack-react-start";
import {
  AuthKitProvider as WorkosAuthKitProvider,
  useAccessToken,
  useAuth,
  type AuthKitProviderProps,
} from "@workos/authkit-tanstack-react-start/client";
import type { AuthKitClientBridge } from "./authkit-client";
import type { WorkosServerAuth } from "./authkit-server";

export const getWorkosServerAuth = (): Promise<WorkosServerAuth> => getAuth();

export const createWorkosAuthkitMiddleware = (input: {
  readonly redirectUri: string;
}) => authkitMiddleware(input);

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
