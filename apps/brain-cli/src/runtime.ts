import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { callApi, failure, type CliResult } from "./api.js";
import {
  defaultConfigDirectory,
  readConfig,
  type BrainConfig,
} from "./config.js";
import { linkTerminal } from "./terminalLink.js";

export const cliVersion = "0.1.0";

export type CliDependencies = {
  readonly cwd: string;
  readonly configDirectory: string;
  readonly assetDirectory: string;
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly fetch: typeof globalThis.fetch;
  readonly now: () => number;
  readonly platform: NodeJS.Platform;
  readonly nodeVersion: string;
  readonly linkAccount: typeof linkTerminal;
};

const packageRoot = fileURLToPath(new URL("..", import.meta.url));

export const defaultDependencies = (): CliDependencies => ({
  cwd: process.cwd(),
  configDirectory: defaultConfigDirectory(process.env),
  assetDirectory: join(packageRoot, "assets", "ask-apero"),
  environment: process.env,
  fetch: globalThis.fetch,
  now: Date.now,
  platform: process.platform,
  nodeVersion: process.version,
  linkAccount: linkTerminal,
});

export const option = (
  argv: readonly string[],
  name: string,
): string | undefined => {
  const index = argv.indexOf(name);
  return index === -1 ? undefined : argv[index + 1];
};

export const configFor = (
  dependencies: CliDependencies,
): BrainConfig | CliResult => {
  const stored = readConfig(dependencies.configDirectory);
  if (!stored)
    return failure("Maestro Brain is not configured. Run maestro-brain setup.");
  const apiKey =
    dependencies.environment.MAESTRO_BRAIN_API_KEY ?? stored.apiKey;
  return apiKey ? { ...stored, apiKey } : stored;
};

export const isCliResult = (
  value: BrainConfig | CliResult,
): value is CliResult => "exitCode" in value;

export const request = async (
  dependencies: CliDependencies,
  request: {
    readonly operationId: string;
    readonly input: Record<string, unknown>;
    readonly idempotencyKey?: string;
  },
): Promise<CliResult> => {
  const config = configFor(dependencies);
  return isCliResult(config)
    ? config
    : await callApi({ config, fetcher: dependencies.fetch, ...request });
};
