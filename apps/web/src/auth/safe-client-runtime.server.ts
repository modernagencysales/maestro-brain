import { getServerEnv } from "../server-env";
import { getSafeClientRuntime } from "./authkit-server";
import { getWorkosServerAuth } from "./workos-server-adapter";

export const loadSafeClientRuntimeOnServer = () =>
  getSafeClientRuntime({
    env: getServerEnv(),
    getAuth: getWorkosServerAuth,
  });
