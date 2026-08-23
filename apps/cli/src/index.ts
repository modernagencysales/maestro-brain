#!/usr/bin/env node
import { runTemplateApiOperation } from "@maestro-template/workflow-tooling";
import { text as readStreamText } from "node:stream/consumers";
import { createCliHandlers } from "./commands";
import { noteInputFromArgs } from "./noteCommand";
import { parseNamedArgs } from "./namedArgs";
import { runRemoteMcpCommand } from "./remoteMcp";
import { brainApiOrigin, containsTenantSelector } from "./remoteSafety";
import { cliFailure, cliSuccess, formatJsonOutput } from "./result";
import { decodeCliRuntimeConfig, emptyCliRuntimeConfig } from "./runtimeConfig";
import { dispatchCliCommand } from "./router";
import { runSnapshotSubmit } from "./snapshotCommand";
import {
  doctorBrainEnvironment,
  setupBrainEnvironment,
  type SetupRuntime,
} from "./environmentSetup";
import type {
  CliCapabilityRequest,
  CliResult,
  CliRuntimeConfig,
} from "./types";

export { decodeCliRuntimeConfig };
export type { CliResult, CliRuntimeConfig };

export const staticCliOperationRefs: Readonly<Record<string, string>> = {};

export const staticCliCapabilityIds: ReadonlySet<string> = new Set(
  Object.keys(staticCliOperationRefs),
);

export const remoteCliOperationRefs: Readonly<Record<string, string>> = {
  "brain.context.get": "brain.context.get",
  "brain.answers.ask": "brain.answers.ask",
  "brain.sources.search": "brain.sources.search",
  "brain.sources.get": "brain.sources.get",
  "brain.rollout.status": "brain.rollout.status",
  "brain.feedback.reportWrongOrStale": "brain.feedback.reportWrongOrStale",
  "brain.notes.submit": "brain.notes.submit",
};

type RemoteBrainRequest = {
  readonly operationId: string;
  readonly input: Record<string, unknown>;
  readonly idempotencyKey?: string;
};

type CliAsyncDependencies = {
  readonly readStdin: () => Promise<string>;
};

const defaultAsyncDependencies: CliAsyncDependencies = {
  readStdin: async () => await readStreamText(process.stdin),
};

const executeRemoteBrainRequest = async (
  request: RemoteBrainRequest,
  config: CliRuntimeConfig,
): Promise<CliResult> => {
  const operationId = remoteCliOperationRefs[request.operationId];
  if (operationId === undefined) {
    return cliFailure(
      `Unknown remote Brain operation: ${request.operationId}\n`,
    );
  }
  if (containsTenantSelector(request.input)) {
    return cliFailure(
      "Brain scope must be derived from MAESTRO_BRAIN_API_KEY.\n",
    );
  }

  const origin = brainApiOrigin(config.brainSiteUrl);
  if (origin === undefined) {
    return cliFailure(
      "CONVEX_SITE_URL must be an HTTPS origin without credentials, path, query, or fragment.\n",
    );
  }
  if (!config.brainApiKey || config.brainApiKey.trim() !== config.brainApiKey) {
    return cliFailure("MAESTRO_BRAIN_API_KEY is required.\n");
  }

  try {
    const response = await fetch(`${origin}/api/${operationId}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${config.brainApiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        input: request.input,
        ...(request.idempotencyKey === undefined
          ? {}
          : { idempotencyKey: request.idempotencyKey }),
      }),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    const responseText = await response.text();
    let body: unknown;
    try {
      body = JSON.parse(responseText);
    } catch {
      return cliFailure(
        `Brain API returned HTTP ${response.status} with a non-JSON response.\n`,
      );
    }
    if (
      body === null ||
      typeof body !== "object" ||
      !("ok" in body) ||
      typeof body.ok !== "boolean"
    ) {
      return cliFailure(
        `Brain API returned HTTP ${response.status} with an invalid response.\n`,
      );
    }

    return {
      exitCode: response.ok && body.ok ? 0 : 1,
      stdout: formatJsonOutput(body)
        .split(config.brainApiKey)
        .join("[REDACTED]"),
      stderr: "",
    };
  } catch {
    return cliFailure(
      "Could not reach Brain API (network error or timeout).\n",
    );
  }
};

const remoteBrainApiResult = async (
  argv: readonly string[],
  config: CliRuntimeConfig,
): Promise<CliResult> => {
  const parsed = parseNamedArgs(argv.slice(3));
  if (!parsed.ok) return cliFailure(`${parsed.message}\n`);
  const { input, idempotencyKey, ...unsupported } = parsed.args;
  if (input === undefined || Object.keys(unsupported).length > 0) {
    return cliFailure(
      "api call requires --input and optionally --idempotency-key.\n",
    );
  }
  return await executeRemoteBrainRequest(
    {
      operationId: argv[2] ?? "",
      input,
      ...(idempotencyKey === undefined ? {} : { idempotencyKey }),
    },
    config,
  );
};

const terminalTextRequest = (
  command: "ask" | "search",
  argv: readonly string[],
): RemoteBrainRequest | CliResult => {
  const text = argv.slice(1).join(" ").trim();
  if (!text)
    return cliFailure(
      `${command} requires a ${command === "ask" ? "question" : "query"}.\n`,
    );
  return command === "ask"
    ? { operationId: "brain.answers.ask", input: { question: text } }
    : { operationId: "brain.sources.search", input: { query: text } };
};

const terminalBrainRequest = (
  argv: readonly string[],
): RemoteBrainRequest | CliResult | undefined => {
  const command = argv[0];
  if (command === "ask" || command === "search")
    return terminalTextRequest(command, argv);
  if (command === "source") {
    const sourceKey = argv[1];
    const citationParts = sourceKey?.startsWith("citation:")
      ? sourceKey.slice("citation:".length).split(":")
      : [];
    return argv.length === 2 && sourceKey?.trim()
      ? citationParts.length === 2
        ? {
            operationId: "brain.sources.get",
            input: {
              publicationSetKey: citationParts[0] as string,
              entryKey: citationParts[1] as string,
            },
          }
        : {
            operationId: "brain.sources.get",
            input: { sourceRevisionKey: sourceKey },
          }
      : cliFailure("source requires one source revision key.\n");
  }
  if (command === "health")
    return argv.length === 1
      ? { operationId: "brain.rollout.status", input: {} }
      : cliFailure("health takes no arguments.\n");
  if (command === "note") {
    const parsed = parseNamedArgs(argv.slice(1));
    if (!parsed.ok) return cliFailure(`${parsed.message}\n`);
    const { input, ...unsupported } = parsed.args;
    return input === undefined ||
      typeof input.title !== "string" ||
      typeof input.markdown !== "string" ||
      Object.keys(unsupported).length > 0
      ? cliFailure(
          'note requires --input with string "title" and "markdown".\n',
        )
      : { operationId: "brain.notes.submit", input };
  }
  if (command !== "feedback") return undefined;

  const parsed = parseNamedArgs(argv.slice(1));
  if (!parsed.ok) return cliFailure(`${parsed.message}\n`);
  const { input, idempotencyKey, ...unsupported } = parsed.args;
  return input === undefined ||
    idempotencyKey === undefined ||
    Object.keys(unsupported).length > 0
    ? cliFailure("feedback requires --input and --idempotency-key.\n")
    : {
        operationId: "brain.feedback.reportWrongOrStale",
        input,
        idempotencyKey,
      };
};

const isCliResult = (
  value: RemoteBrainRequest | CliResult,
): value is CliResult => "exitCode" in value;

const runStaticCliCapability = (
  capabilityId: string,
  request: CliCapabilityRequest,
): CliResult => {
  const operationId = staticCliOperationRefs[capabilityId];
  if (!staticCliCapabilityIds.has(capabilityId) || operationId === undefined) {
    return cliFailure(`Unknown CLI capability: ${capabilityId}\n`);
  }

  const result = runTemplateApiOperation(operationId, request);

  return {
    exitCode: result.ok ? 0 : 1,
    stdout: formatJsonOutput(result),
    stderr: "",
  };
};

const cliHandlers = createCliHandlers({
  capability: {
    hasCapability: (capabilityId) => staticCliCapabilityIds.has(capabilityId),
    runCapability: runStaticCliCapability,
  },
});

const commandHelp: Readonly<Record<string, string>> = {
  setup: [
    "Configure a terminal runtime in the current repository.",
    "",
    "Usage: pnpm brain setup <codex|claude-code|cowork>",
    "Requires: CONVEX_SITE_URL",
    "Writes project-local config and never writes MAESTRO_BRAIN_API_KEY.",
  ].join("\n"),
  doctor: [
    "Verify configuration, API access, and hosted MCP prompts/tools.",
    "",
    "Usage: pnpm brain doctor",
    "Requires: CONVEX_SITE_URL and MAESTRO_BRAIN_API_KEY",
  ].join("\n"),
  note: [
    "Submit one note to the editor review queue.",
    "",
    "Usage:",
    "  pnpm brain note --file <note.md> [--title <title>]",
    "  pnpm brain note --stdin [--title <title>]",
    '  pnpm brain note --input \'{"title":"...","markdown":"..."}\'',
    "Piped Markdown may provide its title as the first H1.",
    "Requires: CONVEX_SITE_URL and MAESTRO_BRAIN_API_KEY",
  ].join("\n"),
  snapshot: [
    "Inspect or submit a Markdown snapshot in stable path order.",
    "",
    "Usage:",
    "  pnpm brain snapshot inspect <directory> --as-of <YYYY-MM-DD> [--source <name>]",
    "  pnpm brain snapshot submit <directory> --as-of <YYYY-MM-DD> [--source <name>]",
    "Inspect is local and prints metadata only. Submit requires both environment variables.",
  ].join("\n"),
  mcp: [
    "Inspect or call the hosted streamable HTTP MCP.",
    "",
    "Usage:",
    "  pnpm brain mcp tools",
    "  pnpm brain mcp prompts",
    "  pnpm brain mcp call <tool-name> [--input <json>]",
    "Requires: CONVEX_SITE_URL and MAESTRO_BRAIN_API_KEY",
  ].join("\n"),
};

const focusedHelp = (argv: readonly string[]): CliResult | undefined => {
  if (argv.length !== 2 || !["--help", "-h"].includes(argv[1] ?? ""))
    return undefined;
  const help = commandHelp[argv[0] ?? ""];
  return help === undefined ? undefined : cliSuccess(`${help}\n`);
};

const withReviewNextStep = (result: CliResult): CliResult => {
  if (result.exitCode !== 0 || !result.stdout) return result;
  try {
    const body = JSON.parse(result.stdout) as Readonly<Record<string, unknown>>;
    return {
      ...result,
      stdout: formatJsonOutput({
        ...body,
        next: [
          "An editor must approve this submission in the /brain review queue.",
          "After approval, verify it with pnpm brain search <query>.",
        ],
      }),
    };
  } catch {
    return result;
  }
};

export const runCli = (
  argv: readonly string[],
  config: CliRuntimeConfig = emptyCliRuntimeConfig,
): CliResult => dispatchCliCommand(cliHandlers, argv, config);

export const runCliAsync = async (
  argv: readonly string[],
  config: CliRuntimeConfig = emptyCliRuntimeConfig,
  dependencies: CliAsyncDependencies = defaultAsyncDependencies,
): Promise<CliResult> => {
  const help = focusedHelp(argv);
  if (help !== undefined) return help;
  if (argv[0] === "snapshot")
    return await runSnapshotSubmit(argv, (note) =>
      executeRemoteBrainRequest(
        {
          operationId: "brain.notes.submit",
          input: { title: note.title, markdown: note.markdown },
        },
        config,
      ),
    );
  if (
    argv[0] === "note" &&
    argv
      .slice(1)
      .some((token) => ["--file", "--stdin", "--title"].includes(token))
  ) {
    const note = await noteInputFromArgs(argv, dependencies.readStdin);
    return note.ok
      ? withReviewNextStep(
          await executeRemoteBrainRequest(
            { operationId: "brain.notes.submit", input: note.input },
            config,
          ),
        )
      : note.result;
  }
  if (argv[0] === "setup")
    return argv.length <= 2 &&
      (argv[1] === undefined ||
        (["codex", "claude-code", "cowork"] as const).includes(
          argv[1] as Exclude<SetupRuntime, "all">,
        ))
      ? setupBrainEnvironment({
          repoRoot: process.cwd(),
          siteUrl: config.brainSiteUrl,
          runtime: (argv[1] as SetupRuntime | undefined) ?? "all",
        })
      : cliFailure("setup accepts codex, claude-code, or cowork.\n");
  if (argv[0] === "doctor")
    return argv.length === 1
      ? await doctorBrainEnvironment(config)
      : cliFailure("doctor takes no arguments.\n");
  const mcpResult = await runRemoteMcpCommand(argv, config);
  if (mcpResult !== undefined) return mcpResult;
  if (argv[0] === "api" && argv[1] === "call")
    return await remoteBrainApiResult(argv, config);
  const terminalRequest = terminalBrainRequest(argv);
  if (terminalRequest === undefined) return runCli(argv, config);
  return isCliResult(terminalRequest)
    ? terminalRequest
    : argv[0] === "note"
      ? withReviewNextStep(
          await executeRemoteBrainRequest(terminalRequest, config),
        )
      : await executeRemoteBrainRequest(terminalRequest, config);
};

if (
  process.argv[1]?.endsWith("index.ts") ||
  process.argv[1]?.endsWith("index.js")
) {
  void runCliAsync(
    process.argv.slice(2),
    decodeCliRuntimeConfig(process.env),
  ).then((result) => {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.exitCode;
  });
}
