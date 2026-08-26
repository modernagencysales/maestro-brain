import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const defaultAppUrl =
  "https://maestro-brain-staging.tim-bb0.workers.dev";
export const defaultApiUrl = "https://perfect-sparrow-808.convex.site";

export type BrainConfig = {
  readonly schemaVersion: 1;
  readonly appUrl: string;
  readonly apiUrl: string;
  readonly workspaceSlug: string;
  readonly apiKey?: string;
};

export const defaultConfigDirectory = (
  environment: Readonly<Record<string, string | undefined>>,
): string =>
  environment.XDG_CONFIG_HOME
    ? join(environment.XDG_CONFIG_HOME, "maestro-brain")
    : join(homedir(), ".config", "maestro-brain");

export const configPath = (directory: string): string =>
  join(directory, "config.json");

export const apiKeySettingsUrl = (config: BrainConfig): string =>
  `${config.appUrl}/${encodeURIComponent(config.workspaceSlug)}/settings/account/api`;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isBrainConfig = (value: unknown): value is BrainConfig => {
  if (!isRecord(value)) return false;
  const fieldsAreValid = [
    value.schemaVersion === 1,
    typeof value.appUrl === "string",
    typeof value.apiUrl === "string",
    typeof value.workspaceSlug === "string",
    value.apiKey === undefined || typeof value.apiKey === "string",
  ];
  return fieldsAreValid.every(Boolean);
};

export const readConfig = (directory: string): BrainConfig | undefined => {
  try {
    const value: unknown = JSON.parse(
      readFileSync(configPath(directory), "utf8"),
    );
    return isBrainConfig(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

export const writeConfig = (directory: string, config: BrainConfig): void => {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  writeFileSync(configPath(directory), `${JSON.stringify(config, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
};

export const removeConfig = (directory: string): void =>
  rmSync(configPath(directory), { force: true });

export const validOrigin = (value: string): string | undefined => {
  try {
    const url = new URL(value);
    const invalidParts = [
      url.protocol !== "https:",
      Boolean(url.username),
      Boolean(url.password),
      url.pathname !== "/",
      Boolean(url.search),
      Boolean(url.hash),
    ];
    return invalidParts.some(Boolean) ? undefined : url.origin;
  } catch {
    return undefined;
  }
};
