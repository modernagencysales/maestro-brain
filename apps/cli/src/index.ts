#!/usr/bin/env node
import { runTemplateApiOperation } from "@maestro-template/workflow-tooling";
import { text as readStreamText } from "node:stream/consumers";
import { createCliHandlers } from "./commands";
import { parseNamedArgs } from "./namedArgs";
import {
  executeRemoteBrainRequest,
  remoteCliOperationRefs,
  type RemoteBrainRequest,
} from "./remoteApi";
import { cliFailure, formatJsonOutput } from "./result";
import { decodeCliRuntimeConfig, emptyCliRuntimeConfig } from "./runtimeConfig";
import { dispatchCliCommand } from "./router";
import { runSpecialCommand, withReviewNextStep } from "./specialCommands";
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

export { remoteCliOperationRefs };

type CliAsyncDependencies = {
  readonly readStdin: () => Promise<string>;
};

const defaultAsyncDependencies: CliAsyncDependencies = {
  readStdin: async () => await readStreamText(process.stdin),
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

export const runCli = (
  argv: readonly string[],
  config: CliRuntimeConfig = emptyCliRuntimeConfig,
): CliResult => dispatchCliCommand(cliHandlers, argv, config);

export const runCliAsync = async (
  argv: readonly string[],
  config: CliRuntimeConfig = emptyCliRuntimeConfig,
  dependencies: CliAsyncDependencies = defaultAsyncDependencies,
): Promise<CliResult> => {
  const specialResult = await runSpecialCommand(
    argv,
    config,
    dependencies.readStdin,
  );
  if (specialResult !== undefined) return specialResult;
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
