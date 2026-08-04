import { api } from "@maestro-template/convex";
import { ConvexHttpClient } from "convex/browser";

import { getWebEnv } from "../env";
import { getServerEnv } from "../server-env";
import { getSafeClientRuntime } from "./authkit-server";
import { getWorkosServerAuth } from "./workos-server-adapter";

const provisionWorkspace = async (accessToken: string) => {
  const client = new ConvexHttpClient(getWebEnv().VITE_CONVEX_URL);
  client.setAuth(accessToken);
  await client.mutation(api.access.provisioning.ensureProvisioned, {});
};

export const loadSafeClientRuntimeOnServer = () =>
  getSafeClientRuntime({
    env: getServerEnv(),
    getAuth: getWorkosServerAuth,
    provisionWorkspace,
  });
