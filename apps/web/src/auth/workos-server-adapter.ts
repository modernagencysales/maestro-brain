import { getAuth } from "@workos/authkit-tanstack-react-start";
import { authkitMiddleware } from "@workos/authkit-tanstack-react-start";

import type { WorkosServerAuth } from "./authkit-server";

export const getWorkosServerAuth = (): Promise<WorkosServerAuth> => getAuth();

export const createWorkosAuthkitMiddleware = (input: {
  readonly redirectUri: string;
}) => authkitMiddleware(input);
