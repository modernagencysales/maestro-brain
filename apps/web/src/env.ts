export const isContractModeRuntime = () =>
  import.meta.env.VITE_MAESTRO_CONTRACT_MODE === "1";

export const hasConfiguredConvexRuntime = () =>
  Boolean(configuredConvexRuntimeUrl());

export const configuredConvexRuntimeUrl = (): string | undefined => {
  const value = import.meta.env.VITE_CONVEX_URL;
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
};

export const isIsolatedContractsRuntime = () =>
  import.meta.env.DEV && isContractModeRuntime();

export const isFixtureAuthRuntime = () =>
  import.meta.env.VITE_MAESTRO_AUTH_MODE === "fixture" ||
  isIsolatedContractsRuntime();
