import * as Schema from "effect/Schema";

export type ProviderMode = "fake" | "test" | "live";

export type EnvSource = Readonly<Record<string, string | undefined>>;

export class EnvConfigError extends Schema.TaggedError<EnvConfigError>()(
  "EnvConfigError",
  {
    name: Schema.String,
    reason: Schema.Literal("missing", "blank"),
  },
) {}

const makeEnvConfigError = (
  name: string,
  reason: "missing" | "blank",
): EnvConfigError => {
  const error = new EnvConfigError({ name, reason });
  const label = reason === "missing" ? "Missing" : "Blank";

  Object.defineProperty(error, "message", {
    value: `${label} required env: ${name}`,
  });

  return error;
};

const trimEnvValue = (value: string | undefined): string | undefined => {
  const trimmed = value?.trim();

  return trimmed ? trimmed : undefined;
};

export const readOptionalEnv = (
  name: string,
  env: EnvSource,
): string | undefined => trimEnvValue(env[name]);

export const readRequiredEnv = (name: string, env: EnvSource): string => {
  if (!(name in env)) {
    throw makeEnvConfigError(name, "missing");
  }

  const value = trimEnvValue(env[name]);

  if (!value) {
    throw makeEnvConfigError(name, "blank");
  }

  return value;
};

export const requireLiveEnv = (
  names: readonly string[],
  mode: ProviderMode,
  env: EnvSource,
): Readonly<Record<string, string>> => {
  if (mode === "fake") {
    return {};
  }

  return Object.fromEntries(
    names.map((name) => [name, readRequiredEnv(name, env)]),
  );
};

export const killSwitchOn = (env: EnvSource): boolean =>
  readOptionalEnv("LLM_DISABLED", env)?.toLowerCase() === "true";
