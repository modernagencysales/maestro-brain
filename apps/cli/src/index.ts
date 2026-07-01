#!/usr/bin/env node
import {
  buildApiCatalog,
  buildHeadlessOperations,
  buildMcpTools,
  describeWorkflowTemplate,
  getHeadlessOperation,
} from "@maestro-template/workflow-tooling";

export type CliResult = {
  readonly exitCode: 0 | 1;
  readonly stdout: string;
  readonly stderr: string;
};

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

export const runCli = (argv: readonly string[]): CliResult => {
  const [command, subcommand, maybeId] = argv;

  if (!command || command === "help" || command === "--help") {
    return {
      exitCode: 0,
      stdout:
        [
          "maestro-template describe",
          "maestro-template operations list",
          "maestro-template operations get <id>",
          "maestro-template api catalog",
          "maestro-template mcp tools",
        ].join("\n") + "\n",
      stderr: "",
    };
  }

  if (command === "describe") {
    return {
      exitCode: 0,
      stdout: json(describeWorkflowTemplate()),
      stderr: "",
    };
  }

  if (command === "operations" && subcommand === "list") {
    return {
      exitCode: 0,
      stdout: json(buildHeadlessOperations()),
      stderr: "",
    };
  }

  if (command === "operations" && subcommand === "get" && maybeId) {
    const operation = getHeadlessOperation(maybeId);

    if (!operation) {
      return {
        exitCode: 1,
        stdout: "",
        stderr: `Unknown operation: ${maybeId}\n`,
      };
    }

    return {
      exitCode: 0,
      stdout: json(operation),
      stderr: "",
    };
  }

  if (command === "api" && subcommand === "catalog") {
    return {
      exitCode: 0,
      stdout: json(buildApiCatalog()),
      stderr: "",
    };
  }

  if (command === "mcp" && subcommand === "tools") {
    return {
      exitCode: 0,
      stdout: json(buildMcpTools()),
      stderr: "",
    };
  }

  return {
    exitCode: 1,
    stdout: "",
    stderr: `Unknown command: ${argv.join(" ")}\n`,
  };
};

if (
  process.argv[1]?.endsWith("index.ts") ||
  process.argv[1]?.endsWith("index.js")
) {
  const result = runCli(process.argv.slice(2));
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}
