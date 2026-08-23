#!/usr/bin/env node
import { runTemplateApiOperation } from "@maestro-template/workflow-tooling";
import { text as readStreamText } from "node:stream/consumers";
import { createCliHandlers } from "./commands";
import {
  executeRemoteBrainRequest,
  remoteCliOperationRefs,
  type RemoteBrainRequest,
} from "./remoteApi";
import { cliFailure, formatJsonOutput } from "./result";
import { decodeCliRuntimeConfig, emptyCliRuntimeConfig } from "./runtimeConfig";
import { dispatchCliCommand } from "./router";
import { runSpecialCommand, withReviewNextStep } from "./specialCommands";
import { terminalBrainRequest } from "./terminalRequest";
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
    : terminalRequest.operationId === "brain.notes.submit"
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
