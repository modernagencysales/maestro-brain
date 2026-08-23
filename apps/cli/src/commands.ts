import {
  buildApiCatalog,
  buildHeadlessOperations,
  buildMcpTools,
  buildOpenApiDocument,
  callMcpTool,
  describeWorkflowTemplate,
  getHeadlessOperation,
  runTemplateWorkflow,
} from "@maestro-template/workflow-tooling";
import {
  providerConfigReport,
  type ProviderMode,
} from "@maestro-template/integrations";
import { parseNamedArgs } from "./namedArgs";
import { cliFailure, cliSuccess, formatJsonOutput } from "./result";
import type {
  CliCapabilityRequest,
  CliCapabilityResolver,
  CliCommandContext,
  CliCommandHandler,
  CliResult,
  CliRuntimeConfig,
} from "./types";
import { buildWorkflowPayloadForCli } from "./workflowReceipt";

type CliCommandDependencies = {
  readonly capability: CliCapabilityResolver;
};

const providerModes = new Set<ProviderMode>(["fake", "test", "live"]);

const helpResult = (): CliResult =>
  cliSuccess(
    [
      "Company Brain CLI",
      "",
      'Examples use maestro-brain. If it is not on PATH, substitute the same absolute invocation or "$BRAIN_CLI" from the checkout setup guide.',
      "",
      "Quick start",
      '  export CONVEX_SITE_URL="https://your-company-brain.example"',
      '  export MAESTRO_BRAIN_API_KEY="<display-once-key>"',
      "  maestro-brain setup <runtime> [--repo <project-directory>]",
      "  maestro-brain doctor",
      '  maestro-brain ask "What is our ICP?"',
      "",
      "Read company context",
      "  maestro-brain ask <question>",
      "  maestro-brain search <query>",
      "  maestro-brain source <citation-key|source-revision-key>",
      "  maestro-brain health",
      "",
      "Add or correct data (submissions enter review)",
      "  maestro-brain note --file <note.md> [--title <title>]",
      "  maestro-brain note --stdin --title <title>",
      "  maestro-brain note --input <json>",
      "  maestro-brain note status <source-key>",
      "  maestro-brain note list [pending_review|published|rejected]",
      "  maestro-brain snapshot inspect <directory> --as-of <YYYY-MM-DD>",
      '  maestro-brain snapshot submit <directory> --as-of <YYYY-MM-DD> [--source "Claude Ask Apero Advisors"]',
      "  maestro-brain feedback --idempotency-key <key> --input <json>",
      "",
      "Inspect or test the hosted HTTP MCP",
      "  maestro-brain mcp tools",
      "  maestro-brain mcp prompts",
      "  maestro-brain mcp call <tool-name> [--input <json>]",
      "",
      "Setup and diagnostics",
      "  maestro-brain setup <runtime>",
      "  maestro-brain doctor",
      "  maestro-brain <command> --help",
      "",
      "Advanced template-development commands (offline; not the hosted Brain)",
      "  maestro-brain describe | operations list | api catalog",
    ].join("\n") + "\n",
  );

const operationsResult = ({
  subcommand,
  target,
}: CliCommandContext): CliResult => {
  if (subcommand === "list") {
    return cliSuccess(formatJsonOutput(buildHeadlessOperations()));
  }

  const operation = getHeadlessOperation(target ?? "");
  return operation
    ? cliSuccess(formatJsonOutput(operation))
    : cliFailure(`Unknown operation: ${target}\n`);
};

const parseCapabilityRequest = (
  argv: readonly string[],
): CliCapabilityRequest | CliResult => {
  const [, , , ...requestArgs] = argv;
  const parsedArgs = parseNamedArgs(requestArgs);
  if (!parsedArgs.ok) {
    return cliFailure(`${parsedArgs.message}\n`);
  }

  const { workspaceSlug, input, idempotencyKey } = parsedArgs.args;
  if (
    workspaceSlug === undefined ||
    input === undefined ||
    idempotencyKey === undefined
  ) {
    return cliFailure(
      "capability run requires --workspace, --input, and --idempotency-key.\n",
    );
  }

  return { workspaceSlug, input, idempotencyKey };
};

const isCliResult = (
  value: CliCapabilityRequest | CliResult,
): value is CliResult => "exitCode" in value;

const capabilityResult = (
  { argv, target }: CliCommandContext,
  capability: CliCapabilityResolver,
): CliResult => {
  const capabilityId = target ?? "";
  if (!capability.hasCapability(capabilityId)) {
    return cliFailure(`Unknown CLI capability: ${target}\n`);
  }

  const request = parseCapabilityRequest(argv);
  return isCliResult(request)
    ? request
    : capability.runCapability(capabilityId, request);
};

const apiResult = ({ subcommand }: CliCommandContext): CliResult =>
  cliSuccess(
    formatJsonOutput(
      subcommand === "catalog" ? buildApiCatalog() : buildOpenApiDocument(),
    ),
  );

const mcpToolsResult = (): CliResult =>
  cliSuccess(formatJsonOutput(buildMcpTools()));

const mcpCallResult = ({ target }: CliCommandContext): CliResult => {
  const result = callMcpTool(target ?? "");

  return {
    exitCode: result.isError ? 1 : 0,
    stdout: formatJsonOutput(result),
    stderr: "",
  };
};

const mcpResult = (context: CliCommandContext): CliResult =>
  context.subcommand === "tools" ? mcpToolsResult() : mcpCallResult(context);

const parseProviderMode = (mode: string): ProviderMode | undefined =>
  providerModes.has(mode as ProviderMode) ? (mode as ProviderMode) : undefined;

const integrationsResult = (
  { target }: CliCommandContext,
  config: CliRuntimeConfig,
): CliResult => {
  const mode = target ?? "fake";
  const providerMode = parseProviderMode(mode);

  return providerMode === undefined
    ? cliFailure(`Unknown provider mode: ${mode}\n`)
    : cliSuccess(
        formatJsonOutput(
          providerConfigReport(providerMode, config.providerEnv),
        ),
      );
};

const workflowResult = ({ argv }: CliCommandContext): CliResult => {
  const workflowArgs = argv.slice(2);
  const parsedArgs = parseNamedArgs(workflowArgs);
  if (!parsedArgs.ok) {
    return cliFailure(`${parsedArgs.message}\n`);
  }

  try {
    return cliSuccess(
      formatJsonOutput(
        buildWorkflowPayloadForCli(runTemplateWorkflow(), parsedArgs.args),
      ),
    );
  } catch (error) {
    return cliFailure(
      `${error instanceof Error ? error.message : "Workflow run failed."}\n`,
    );
  }
};

export const createCliHandlers = ({
  capability,
}: CliCommandDependencies): readonly CliCommandHandler[] => [
  {
    matches: ({ command }) =>
      !command || command === "help" || command === "--help",
    run: () => helpResult(),
  },
  {
    matches: ({ command }) => command === "describe",
    run: () => cliSuccess(formatJsonOutput(describeWorkflowTemplate())),
  },
  {
    matches: ({ command, subcommand, target }) =>
      command === "operations" &&
      (subcommand === "list" || (subcommand === "get" && target !== undefined)),
    run: (context) => operationsResult(context),
  },
  {
    matches: ({ command, subcommand }) =>
      command === "workflow" && subcommand === "run",
    run: (context) => workflowResult(context),
  },
  {
    matches: ({ command, subcommand, target }) =>
      command === "capability" && subcommand === "run" && target !== undefined,
    run: (context) => capabilityResult(context, capability),
  },
  {
    matches: ({ command, subcommand }) =>
      command === "api" &&
      (subcommand === "catalog" || subcommand === "openapi"),
    run: (context) => apiResult(context),
  },
  {
    matches: ({ command, subcommand, target }) =>
      command === "mcp" &&
      (subcommand === "tools" ||
        (subcommand === "call" && target !== undefined)),
    run: (context) => mcpResult(context),
  },
  {
    matches: ({ command, subcommand }) =>
      command === "integrations" && subcommand === "report",
    run: (context, config) => integrationsResult(context, config),
  },
];
