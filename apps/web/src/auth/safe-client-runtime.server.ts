import { api } from "@maestro-template/convex";
import { ConvexHttpClient } from "convex/browser";

import { getWebEnv } from "../env";
import { getServerEnv, readRequiredServerEnv } from "../server-env";
import { ensureAgencyForUser } from "./agency-onboarding";
import { getSafeClientRuntime } from "./authkit-server";
import { createWorkosAgencyDependencies } from "./workos-agency-adapter";
import { getWorkosServerAuth } from "./workos-server-adapter";

const provisionWorkspace = async (accessToken: string) => {
  const client = new ConvexHttpClient(getWebEnv().VITE_CONVEX_URL);
  client.setAuth(accessToken);
  await client.action(api.access.provisioning.ensureProvisionedFromWorkos, {});
};

export const loadSafeClientRuntimeOnServer = () => {
  const env = getServerEnv();
  return getSafeClientRuntime({
    env,
    getAuth: getWorkosServerAuth,
    provisionWorkspace,
    onboardAgency: (user) =>
      ensureAgencyForUser({
        user,
        dependencies: createWorkosAgencyDependencies({
          apiKey: readRequiredServerEnv("WORKOS_API_KEY", env),
        }),
      }),
  });
};
