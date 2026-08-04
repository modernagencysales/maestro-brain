import { providerDescriptors } from "@maestro-template/integrations";
import type { CliRuntimeConfig } from "./types";

export const emptyCliRuntimeConfig: CliRuntimeConfig = {
  providerEnv: {},
};

const cliProviderEnvNames = [
  ...new Set(
    providerDescriptors.flatMap((descriptor) => descriptor.requiredEnv),
  ),
];

export const decodeCliRuntimeConfig = (
  env: Readonly<Record<string, string | undefined>>,
): CliRuntimeConfig => ({
  providerEnv: Object.fromEntries(
    cliProviderEnvNames.map((name) => [name, env[name]]),
  ),
  ...(env.CONVEX_SITE_URL === undefined
    ? {}
    : { brainSiteUrl: env.CONVEX_SITE_URL }),
  ...(env.MAESTRO_BRAIN_API_KEY === undefined
    ? {}
    : { brainApiKey: env.MAESTRO_BRAIN_API_KEY }),
});
