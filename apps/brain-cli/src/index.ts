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
  maestro-brain run -- codex
  maestro-brain run -- claude
  maestro-brain doctor
  maestro-brain status
  maestro-brain logout
  maestro-brain version
  maestro-brain update

Use company context
  maestro-brain ask <question> [--save-example]
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

const commandHelp: Readonly<Record<string, string | undefined>> = {
  setup: `Usage: maestro-brain setup [--project <directory>]
       maestro-brain setup --workspace <slug> --api-key <key> [--api-url <origin>] [--project <directory>]

Links this terminal to a workspace and writes Codex, Claude Code, Claude Cowork,
and Ask Apero project configuration. With --workspace and --api-key, setup is
non-interactive.`,
  env: `Usage: eval "$(maestro-brain env)"

Prints a shell export for the linked API key. Use maestro-brain run when you do
not want to modify the current shell environment.`,
  run: `Usage: maestro-brain run -- <command> [args...]

Runs one child process with MAESTRO_BRAIN_API_KEY injected.`,
  ask: `Usage: maestro-brain ask <question> [--save-example]

--save-example explicitly stores this question and its immutable citation
references in the shared rolling evaluation set.`,
  evidence: `Usage: maestro-brain evidence search <query> [--limit <1-10>]
       maestro-brain evidence source-get <source-key> <revision-key>
       maestro-brain evidence health`,
  page: `Usage: maestro-brain page list [--include-archived] [--full]
       maestro-brain page get <page-id>
       maestro-brain page create <file.md> [--slug <slug>] [--title <title>]
       maestro-brain page update <page-id> <file.md> --expected-updated-at <ms>

page list omits Markdown bodies by default to keep agent context small. Pass
--full to return the complete API response.`,
  import: `Usage: maestro-brain import <folder> [--adopt-existing]

Recursively creates or safely updates Markdown-backed Brain pages.`,
  mcp: `Usage: maestro-brain mcp doctor
       maestro-brain mcp tools [--full]
       maestro-brain mcp prompts

mcp tools returns names and descriptions by default. Pass --full to include
the complete tool schemas.`,
  doctor: "Usage: maestro-brain doctor",
  status: "Usage: maestro-brain status",
  logout: "Usage: maestro-brain logout",
  version: "Usage: maestro-brain version",
  update: "Usage: maestro-brain update",
  "bug-bundle": "Usage: maestro-brain bug-bundle [--output <file.json>]",
};

const helpFor = (command: string | undefined): CliResult =>
  command && commandHelp[command]
    ? success(commandHelp[command] as string)
    : command
      ? failure(
          `Unknown command: ${command}\nRun maestro-brain --help for commands.`,
        )
      : success(help.trimEnd());

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

const runCommand = (
  argv: readonly string[],
  dependencies: CliDependencies,
): CliResult => {
  const config = configFor(dependencies);
  if (isCliResult(config)) return config;
  if (!config.apiKey)
    return failure("No linked API key is configured. Run maestro-brain setup.");
  const separator = argv.indexOf("--");
  const commandIndex = separator === -1 ? 1 : separator + 1;
  const command = argv[commandIndex]?.trim();
  if (!command)
    return failure("Usage: maestro-brain run -- <command> [args...]");
  const result = dependencies.runProcess(
    command,
    argv.slice(commandIndex + 1),
    {
      cwd: dependencies.cwd,
      environment: {
        ...dependencies.environment,
        MAESTRO_BRAIN_API_KEY: config.apiKey,
      },
    },
  );
  if (result.error)
    return failure(`Could not start ${command}: ${result.error.message}`);
  if (result.status !== 0)
    return {
      ...failure(
        result.signal
          ? `${command} exited after signal ${result.signal}.`
          : `${command} exited with status ${result.status ?? "unknown"}.`,
      ),
      exitCode: result.status ?? 1,
    };
  return success({ ok: true, command });
};

type CommandHandler = () => CliResult | Promise<CliResult>;

const commandHandlers = (
  argv: readonly string[],
  dependencies: CliDependencies,
): Readonly<Record<string, CommandHandler | undefined>> => ({
  help: () => helpFor(argv[1]),
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
  run: () => runCommand(argv, dependencies),
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
      command: `npm install --global https://github.com/modernagencysales/maestro-brain/releases/download/brain-cli-v${cliVersion}/maestro-brain.tgz`,
      version: cliVersion,
      automatic: false,
    }),
  ask: async () => {
    const saveExample = argv.includes("--save-example");
    const question = argv
      .slice(1)
      .filter((argument) => argument !== "--save-example")
      .join(" ")
      .trim();
    if (!question) return failure("ask requires a question.");
    const answer = await request(dependencies, {
      operationId: "agents.assistant.answerQuestion",
      input: { question },
    });
    if (!saveExample || answer.exitCode !== 0) return answer;
    let payload: unknown;
    try {
      payload = JSON.parse(answer.stdout);
    } catch {
      return failure("Answer succeeded but could not be saved as an example.");
    }
    if (
      payload === null ||
      typeof payload !== "object" ||
      !("result" in payload) ||
      payload.result === null ||
      typeof payload.result !== "object" ||
      !("status" in payload.result) ||
      (payload.result.status !== "answered" &&
        payload.result.status !== "insufficient-context") ||
      !("contextPack" in payload.result) ||
      payload.result.contextPack === null ||
      typeof payload.result.contextPack !== "object" ||
      !("packHash" in payload.result.contextPack) ||
      typeof payload.result.contextPack.packHash !== "string" ||
      !("citations" in payload.result.contextPack) ||
      !Array.isArray(payload.result.contextPack.citations)
    )
      return failure("Answer succeeded but could not be saved as an example.");
    const references = payload.result.contextPack.citations.flatMap(
      (citation) =>
        citation !== null &&
        typeof citation === "object" &&
        "sourceId" in citation &&
        typeof citation.sourceId === "string" &&
        "revisionKey" in citation &&
        typeof citation.revisionKey === "string" &&
        "contentHash" in citation &&
        typeof citation.contentHash === "string"
          ? [
              {
                sourceKey: citation.sourceId,
                revisionKey: citation.revisionKey,
                contentHash: citation.contentHash,
              },
            ]
          : [],
    );
    const exampleKey = `cli:${payload.result.contextPack.packHash}`;
    const saved = await request(dependencies, {
      operationId: "agents.assistant.saveEvaluationExample",
      input: {
        exampleKey,
        question,
        purpose: "company-question",
        evidenceMode: "recent_evidence",
        surface: "cli",
        answerStatus: payload.result.status,
        packHash: payload.result.contextPack.packHash,
        evidenceReferences: references,
        captureKind: "test",
        usefulness: "unrated",
      },
      idempotencyKey: exampleKey,
    });
    if (saved.exitCode !== 0) return saved;
    const savedPayload: unknown = JSON.parse(saved.stdout);
    return success({
      answer: payload.result,
      evaluationExample:
        savedPayload !== null &&
        typeof savedPayload === "object" &&
        "result" in savedPayload
          ? { saved: true, id: savedPayload.result }
          : { saved: true },
    });
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
  if (
    argv.slice(1).some((argument) => argument === "--help" || argument === "-h")
  )
    return helpFor(command);
  const handler = commandHandlers(argv, dependencies)[command];
  return handler
    ? await handler()
    : failure(
        `Unknown command: ${argv.join(" ")}\nRun maestro-brain --help for commands.`,
      );
};

export type { CliDependencies } from "./runtime.js";
export type { CliResult } from "./api.js";
