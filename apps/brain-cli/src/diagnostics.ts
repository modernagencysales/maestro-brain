import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { callApi, callMcp, failure, success, type CliResult } from "./api.js";
import { apiKeySettingsUrl, readConfig } from "./config.js";
import {
  cliVersion,
  configFor,
  isCliResult,
  option,
  type CliDependencies,
} from "./runtime.js";

export const doctorCommand = async (
  dependencies: CliDependencies,
): Promise<CliResult> => {
  const config = configFor(dependencies);
  if (isCliResult(config)) return config;
  const api = await callApi({
    config,
    fetcher: dependencies.fetch,
    operationId: "auth.workspaces.list",
    input: {},
  });
  const mcp = await callMcp(config, dependencies.fetch, "initialize");
  const ok = api.exitCode === 0 && mcp.exitCode === 0;
  return {
    ...success({
      ok,
      checks: {
        config: true,
        credential: true,
        api: api.exitCode === 0,
        mcp: mcp.exitCode === 0,
      },
    }),
    exitCode: ok ? 0 : 1,
  };
};

export const statusCommand = (dependencies: CliDependencies): CliResult => {
  const config = readConfig(dependencies.configDirectory);
  const apiKeyPresent = Boolean(
    dependencies.environment.MAESTRO_BRAIN_API_KEY ?? config?.apiKey,
  );
  return success({
    configured: Boolean(config),
    ...(config
      ? {
          appUrl: config.appUrl,
          apiUrl: config.apiUrl,
          workspaceSlug: config.workspaceSlug,
          apiKeyPresent,
          settingsUrl: apiKeySettingsUrl(config),
        }
      : {}),
  });
};

export const bugBundleCommand = (
  argv: readonly string[],
  dependencies: CliDependencies,
): CliResult => {
  const config = readConfig(dependencies.configDirectory);
  const bundle = {
    schemaVersion: 1,
    createdAt: new Date(dependencies.now()).toISOString(),
    cliVersion,
    nodeVersion: dependencies.nodeVersion,
    platform: dependencies.platform,
    config: config
      ? {
          appUrl: config.appUrl,
          apiUrl: config.apiUrl,
          workspaceSlug: config.workspaceSlug,
          apiKeyPresent: Boolean(
            dependencies.environment.MAESTRO_BRAIN_API_KEY ?? config.apiKey,
          ),
        }
      : { configured: false },
  };
  const output = option(argv, "--output");
  if (!output) return success(bundle);
  const path = resolve(dependencies.cwd, output);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
  return success({ ok: true, output: path });
};

export const mcpCommand = async (
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> => {
  const config = configFor(dependencies);
  if (isCliResult(config)) return config;
  const methods = {
    doctor: "initialize",
    tools: "tools/list",
    prompts: "prompts/list",
  } as const;
  const method = methods[argv[1] as keyof typeof methods];
  return method
    ? await callMcp(config, dependencies.fetch, method)
    : failure("Usage: maestro-brain mcp doctor|tools|prompts");
};
