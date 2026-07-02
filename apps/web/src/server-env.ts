export type ServerEnvSource = Readonly<Record<string, string | undefined>>;

const requiredWorkosEnv = [
  "WORKOS_API_KEY",
  "WORKOS_CLIENT_ID",
  "WORKOS_COOKIE_PASSWORD",
  "WORKOS_REDIRECT_URI",
] as const;

export const hasWorkosServerEnv = (env: ServerEnvSource): boolean =>
  requiredWorkosEnv.every((name) => Boolean(env[name]?.trim()));

export const getServerEnv = (): ServerEnvSource => {
  const maybeProcess = globalThis as typeof globalThis & {
    readonly process?: { readonly env?: ServerEnvSource };
  };

  return maybeProcess.process?.env ?? {};
};
