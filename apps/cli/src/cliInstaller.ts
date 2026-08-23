import { lstatSync, mkdirSync, readlinkSync, symlinkSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { cliFailure, formatJsonOutput } from "./result";
import type { CliResult } from "./types";

const bundledExecutable = fileURLToPath(
  new URL("../bin/maestro-brain.mjs", import.meta.url),
);

const pathExists = (path: string): boolean => {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      Reflect.get(error, "code") === "ENOENT"
    )
      return false;
    throw error;
  }
};

const binDirectoryFrom = (
  argv: readonly string[],
  currentDirectory: string,
  defaultBinDirectory: string,
): string | undefined => {
  if (argv.length === 1) return defaultBinDirectory;
  const inline = argv[1]?.startsWith("--bin-dir=")
    ? argv[1].slice("--bin-dir=".length)
    : undefined;
  if (argv.length === 2 && inline) return resolve(currentDirectory, inline);
  return argv.length === 3 && argv[1] === "--bin-dir" && argv[2]
    ? resolve(currentDirectory, argv[2])
    : undefined;
};

const directoryIsOnPath = (
  binDirectory: string,
  pathValue: string | undefined,
): boolean =>
  (pathValue ?? "")
    .split(delimiter)
    .filter(Boolean)
    .some((entry) => resolve(entry) === binDirectory);

const existingInstallStatus = (
  destination: string,
  executablePath: string,
): "unchanged" | "conflict" => {
  const metadata = lstatSync(destination);
  if (!metadata.isSymbolicLink()) return "conflict";
  const target = resolve(dirname(destination), readlinkSync(destination));
  return target === executablePath ? "unchanged" : "conflict";
};

type InstallStatus = "created" | "unchanged" | "conflict";

const ensureCommandLink = (
  binDirectory: string,
  destination: string,
  executablePath: string,
): InstallStatus => {
  if (pathExists(destination))
    return existingInstallStatus(destination, executablePath);
  mkdirSync(binDirectory, { recursive: true });
  symlinkSync(executablePath, destination, "file");
  return "created";
};

const unavailableExecutable = (executablePath: string): CliResult => ({
  exitCode: 1,
  stdout: formatJsonOutput({
    ok: false,
    error: `CLI executable is unavailable: ${executablePath}`,
  }),
  stderr: "",
});

const conflictingCommand = (destination: string): CliResult => ({
  exitCode: 1,
  stdout: formatJsonOutput({
    ok: false,
    command: destination,
    status: "conflict",
    error: "Refusing to replace an existing command.",
  }),
  stderr: "",
});

const installedCommand = (
  binDirectory: string,
  destination: string,
  status: Exclude<InstallStatus, "conflict">,
  pathValue: string | undefined,
): CliResult => {
  const pathConfigured = directoryIsOnPath(binDirectory, pathValue);
  return {
    exitCode: 0,
    stdout: formatJsonOutput({
      ok: true,
      command: destination,
      status,
      pathConfigured,
      next: pathConfigured
        ? ["Run maestro-brain --help from any directory."]
        : [
            `Add ${binDirectory} to PATH and start a new shell.`,
            `Until then, run ${destination} directly.`,
          ],
    }),
    stderr: "",
  };
};

const installFailure = (destination: string): CliResult => ({
  exitCode: 1,
  stdout: formatJsonOutput({
    ok: false,
    command: destination,
    error: "Could not install the command in the requested directory.",
  }),
  stderr: "",
});

export const installBrainCli = ({
  binDirectory,
  executablePath = bundledExecutable,
  pathValue = process.env.PATH,
}: {
  readonly binDirectory: string;
  readonly executablePath?: string;
  readonly pathValue?: string;
}): CliResult => {
  const resolvedBinDirectory = resolve(binDirectory);
  const resolvedExecutable = resolve(executablePath);
  const destination = join(resolvedBinDirectory, "maestro-brain");
  if (
    !pathExists(resolvedExecutable) ||
    !lstatSync(resolvedExecutable).isFile()
  )
    return unavailableExecutable(resolvedExecutable);

  try {
    const status = ensureCommandLink(
      resolvedBinDirectory,
      destination,
      resolvedExecutable,
    );
    return status === "conflict"
      ? conflictingCommand(destination)
      : installedCommand(resolvedBinDirectory, destination, status, pathValue);
  } catch {
    return installFailure(destination);
  }
};

export const runInstallCommand = (
  argv: readonly string[],
  options: {
    readonly currentDirectory?: string;
    readonly defaultBinDirectory?: string;
    readonly executablePath?: string;
    readonly pathValue?: string;
  } = {},
): CliResult | undefined => {
  if (argv[0] !== "install") return undefined;
  const currentDirectory = options.currentDirectory ?? process.cwd();
  const binDirectory = binDirectoryFrom(
    argv,
    currentDirectory,
    options.defaultBinDirectory ?? join(homedir(), ".local", "bin"),
  );
  if (binDirectory === undefined)
    return cliFailure("install accepts only --bin-dir <directory>.\n");
  return installBrainCli({
    binDirectory,
    ...(options.executablePath === undefined
      ? {}
      : { executablePath: options.executablePath }),
    ...(options.pathValue === undefined
      ? {}
      : { pathValue: options.pathValue }),
  });
};
