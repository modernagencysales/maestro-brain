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

const evidenceCoverage = (
  result: CliResult,
):
  | { readonly providers: unknown[]; readonly warnings: string[] }
  | undefined => {
  if (result.exitCode !== 0) return undefined;
  try {
    const body = JSON.parse(result.stdout) as {
      result?: { providers?: unknown[] };
    };
    if (!Array.isArray(body.result?.providers)) return undefined;
    const providers = body.result.providers;
    const activeProviders = providers.filter(
      (provider) =>
        provider !== null &&
        typeof provider === "object" &&
        "activeSourceCount" in provider &&
        typeof provider.activeSourceCount === "number" &&
        provider.activeSourceCount > 0,
    );
    const emptyProviderNames = providers.flatMap((provider) => {
      if (
        provider === null ||
        typeof provider !== "object" ||
        !("provider" in provider) ||
        typeof provider.provider !== "string" ||
        !("activeSourceCount" in provider) ||
        provider.activeSourceCount !== 0
      )
        return [];
      return [provider.provider];
    });
    return {
      providers,
      warnings: [
        ...(activeProviders.length === 0
          ? [
              "No provider currently has active evidence. Connectivity passed, but company context is empty.",
            ]
          : []),
        ...(emptyProviderNames.length > 0
          ? [`No active evidence for: ${emptyProviderNames.join(", ")}.`]
          : []),
      ],
    };
  } catch {
    return undefined;
  }
};

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
  const coverage = evidenceCoverage(evidence);
  return {
    ...success({
      ok,
      checks,
      ...(coverage ? { evidenceCoverage: coverage.providers } : {}),
      warnings: coverage?.warnings ?? [],
      notChecked: [
        "Codex or Claude project trust/approval",
        "Claude account login",
        "Claude Cowork connector import",
      ],
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
    cliVersion,
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
  if (!method)
    return failure("Usage: maestro-brain mcp doctor|tools [--full]|prompts");
  const result = await callMcp(config, dependencies.fetch, method);
  if (
    method !== "tools/list" ||
    argv.includes("--full") ||
    result.exitCode !== 0
  )
    return result;
  try {
    const body = JSON.parse(result.stdout) as {
      response?: { result?: { tools?: unknown[] } };
    };
    const tools = Array.isArray(body.response?.result?.tools)
      ? body.response.result.tools.flatMap((tool) => {
          if (
            tool === null ||
            typeof tool !== "object" ||
            !("name" in tool) ||
            typeof tool.name !== "string"
          )
            return [];
          return [
            {
              name: tool.name,
              ...("description" in tool && typeof tool.description === "string"
                ? { description: tool.description }
                : {}),
            },
          ];
        })
      : [];
    return success({ ok: true, tools, count: tools.length });
  } catch {
    return result;
  }
};
