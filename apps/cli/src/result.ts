import type { CliResult } from "./types";

export const formatJsonOutput = (value: unknown): string =>
  `${JSON.stringify(value, null, 2)}\n`;

export const cliSuccess = (stdout: string): CliResult => ({
  exitCode: 0,
  stdout,
  stderr: "",
});

export const cliFailure = (stderr: string): CliResult => ({
  exitCode: 1,
  stdout: "",
  stderr,
});
