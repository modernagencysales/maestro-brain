import { failure, success, type CliResult } from "./api.js";
import {
  defaultApiUrl,
  defaultAppUrl,
  removeConfig,
  validOrigin,
} from "./config.js";
import {
  bugBundleCommand,
  doctorCommand,
  mcpCommand,
  statusCommand,
} from "./diagnostics.js";
import { evidenceCommand } from "./evidenceCommand.js";
import { importCommand } from "./importCommand.js";
import { pageCommand } from "./pageCommand.js";
import {
  cliVersion,
  configFor,
  defaultDependencies,
  isCliResult,
  option,
  request,
  type CliDependencies,
} from "./runtime.js";
import { setupProject } from "./setup.js";

const help = `Maestro Brain CLI

Setup and diagnostics
  maestro-brain setup [--project <directory>]
  maestro-brain setup --workspace <slug> --api-key <key> [--api-url <origin>]
  eval "$(maestro-brain env)"
  maestro-brain doctor
  maestro-brain status
  maestro-brain logout
  maestro-brain version
  maestro-brain update

Use company context
  maestro-brain ask <question>
  maestro-brain evidence search <query> [--limit <1-10>]
  maestro-brain evidence source-get <source-key> <revision-key>
  maestro-brain evidence health
  maestro-brain page list [--include-archived]
  maestro-brain page get <page-id>
  maestro-brain page create <file.md> [--slug <slug>] [--title <title>]
  maestro-brain page update <page-id> <file.md> --expected-updated-at <ms>
  maestro-brain import <folder> [--adopt-existing]

HTTP MCP troubleshooting
  maestro-brain mcp doctor|tools|prompts
  maestro-brain bug-bundle [--output <file.json>]
`;

const setupCommand = async (
  argv: readonly string[],
  dependencies: CliDependencies,
): Promise<CliResult> => {
  const appUrl = validOrigin(option(argv, "--app-url") ?? defaultAppUrl);
  if (!appUrl) return failure("App URL must be an HTTPS origin.");
  const apiKey =
    option(argv, "--api-key") ?? dependencies.environment.MAESTRO_BRAIN_API_KEY;
  const workspaceSlug = option(argv, "--workspace")?.trim();
  let linked: { key: string; workspace: string; origin: string };
  if (apiKey && workspaceSlug) {
    const origin = validOrigin(option(argv, "--api-url") ?? defaultApiUrl);
    if (!origin) return failure("API URL must be an HTTPS origin.");
    linked = { key: apiKey, workspace: workspaceSlug, origin };
  } else if (apiKey || workspaceSlug) {
    return failure("Automation setup requires both --workspace and --api-key.");
  } else {
    try {
      linked = await dependencies.linkAccount({
        siteOrigin: appUrl,
        apiOrigin: defaultApiUrl,
        platform: dependencies.platform,
      });
    } catch (error) {
      return failure(
        error instanceof Error ? error.message : "Terminal linking failed.",
      );
    }
  }
  return setupProject({
    root: option(argv, "--project") ?? dependencies.cwd,
    configDirectory: dependencies.configDirectory,
    assetDirectory: dependencies.assetDirectory,
    config: {
      schemaVersion: 1,
      appUrl,
      apiUrl: linked.origin,
      workspaceSlug: linked.workspace,
      apiKey: linked.key,
    },
  });
};

type CommandHandler = () => CliResult | Promise<CliResult>;

const commandHandlers = (
  argv: readonly string[],
  dependencies: CliDependencies,
): Readonly<Record<string, CommandHandler | undefined>> => ({
  help: () => success(help.trimEnd()),
  "--help": () => success(help.trimEnd()),
  "-h": () => success(help.trimEnd()),
  setup: async () => await setupCommand(argv, dependencies),
  env: () => {
    const config = configFor(dependencies);
    if (isCliResult(config)) return config;
    if (!config.apiKey) return failure("No linked API key is configured.");
    const quoted = config.apiKey.replaceAll("'", "'\\''");
    return success(`export MAESTRO_BRAIN_API_KEY='${quoted}'`);
  },
  doctor: async () => await doctorCommand(dependencies),
  status: () => statusCommand(dependencies),
  logout: () => {
    removeConfig(dependencies.configDirectory);
    return success({
      ok: true,
      revoked: false,
      next: "Revoke the API key in browser settings if required.",
    });
  },
  version: () => success(cliVersion),
  update: () =>
    success({
      command:
        "npm install --global https://github.com/modernagencysales/maestro-brain/releases/latest/download/maestro-brain.tgz",
      automatic: false,
    }),
  ask: async () => {
    const question = argv.slice(1).join(" ").trim();
    return question
      ? await request(dependencies, {
          operationId: "agents.assistant.answerQuestion",
          input: { question },
        })
      : failure("ask requires a question.");
  },
  evidence: async () => await evidenceCommand(argv, dependencies),
  page: async () => await pageCommand(argv, dependencies),
  import: async () =>
    await importCommand(argv[1], dependencies, {
      adoptExisting: argv.includes("--adopt-existing"),
    }),
  mcp: async () => await mcpCommand(argv, dependencies),
  "bug-bundle": () => bugBundleCommand(argv, dependencies),
});

export const runCli = async (
  argv: readonly string[],
  dependencies: CliDependencies = defaultDependencies(),
): Promise<CliResult> => {
  const command = argv[0] ?? "help";
  const handler = commandHandlers(argv, dependencies)[command];
  return handler
    ? await handler()
    : failure(`Unknown command: ${argv.join(" ")}`);
};

export type { CliDependencies } from "./runtime.js";
export type { CliResult } from "./api.js";
