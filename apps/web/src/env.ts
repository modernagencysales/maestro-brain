export const isContractModeRuntime = () =>
  import.meta.env.VITE_MAESTRO_CONTRACT_MODE === "1";

export const hasConfiguredConvexRuntime = () =>
  Boolean(import.meta.env.VITE_CONVEX_URL);

export const isIsolatedContractsRuntime = () =>
  import.meta.env.DEV && isContractModeRuntime();

export const isFixtureAuthRuntime = () =>
  import.meta.env.VITE_MAESTRO_AUTH_MODE === "fixture" ||
  isIsolatedContractsRuntime();
