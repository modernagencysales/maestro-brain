import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  callApi,
  callMcp,
  callMcpTool,
  failure,
  success,
  type CliResult,
} from "./api.js";
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
  const tools = await callMcp(config, dependencies.fetch, "tools/list");
  const evidence = await callMcpTool(
    config,
    dependencies.fetch,
    "template.brain.evidence.health",
    {},
  );
  const checks = {
    config: { ok: true },
    api: { ok: api.exitCode === 0, detail: api.stderr.trim() || undefined },
    mcpProtocol: {
      ok: mcp.exitCode === 0,
      detail: mcp.stderr.trim() || undefined,
    },
    mcpTools: {
      ok: tools.exitCode === 0,
      detail: tools.stderr.trim() || undefined,
    },
    workspaceEvidence: {
      ok: evidence.exitCode === 0,
      detail: evidence.stderr.trim() || undefined,
    },
  };
  const ok = Object.values(checks).every(({ ok }) => ok);
  return {
    ...success({
      ok,
      checks,
      ...(ok
        ? {}
        : {
            next: [
              "Run maestro-brain status and confirm the expected workspace.",
              "Rerun maestro-brain setup if the key or workspace is stale.",
              "Run maestro-brain mcp tools for the raw MCP response.",
            ],
          }),
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
      : {
          next: "Run maestro-brain setup from the project to link a workspace.",
        }),
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
