import {
  authkitMiddleware,
  getAuth,
  signOut,
  switchToOrganization,
} from "@workos/authkit-tanstack-react-start";

import type { WorkosServerAuth } from "./authkit-server";

export const getWorkosServerAuth = (): Promise<WorkosServerAuth> => getAuth();

export const createWorkosAuthkitMiddleware = (input: {
  readonly redirectUri: string;
}) => authkitMiddleware(input);

export const switchWorkosOrganization = switchToOrganization;

export const signOutWorkos = signOut;
