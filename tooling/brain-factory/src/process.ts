import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export class RtkCommandError extends Error {
  readonly output: string;

  constructor(message: string, output: string) {
    super(message);
    this.name = "RtkCommandError";
    this.output = output;
  }
}

export const runRtk = (
  args: readonly string[],
  options: {
    readonly cwd?: string;
    readonly env?: NodeJS.ProcessEnv;
    readonly quiet?: boolean;
  } = {},
): string => {
  const result = spawnSync("rtk", [...args], {
    cwd: options.cwd,
    env: options.env,
    encoding: "utf8",
    stdio: options.quiet ? "pipe" : ["ignore", "pipe", "inherit"],
  });
  if (result.status !== 0) {
    const output = [result.stdout, options.quiet ? result.stderr : undefined]
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
      .join("\n");
    throw new RtkCommandError(
      `rtk ${args.join(" ")} failed (${result.status ?? "unknown"})${
        output.length > 0 ? `\n\n## output\n${output}` : ""
      }`,
      output,
    );
  }
  return result.stdout.trim();
};

export const runRtkToFile = (
  args: readonly string[],
  outputPath: string,
  options: { readonly cwd?: string; readonly outcomePath?: string } = {},
): string => {
  const output = openSync(outputPath, "wx");
  let result: ReturnType<typeof spawnSync>;
  try {
    result = spawnSync("rtk", [...args], {
      cwd: options.cwd,
      encoding: "utf8",
      stdio: ["ignore", output, "inherit"],
    });
  } finally {
    closeSync(output);
  }
  if (options.outcomePath) {
    const outputContent = readFileSync(outputPath, "utf8");
    const spawnError = result.error as NodeJS.ErrnoException | undefined;
    const kind = spawnError
      ? "spawn_error"
      : result.signal !== null
        ? "signaled"
        : result.status === null
          ? "indeterminate"
          : "exited";
    writeFileSync(
      options.outcomePath,
      `${JSON.stringify(
        {
          errorCode:
            typeof spawnError?.code === "string" ? spawnError.code : null,
          errorSyscall:
            typeof spawnError?.syscall === "string" ? spawnError.syscall : null,
          kind,
          outputPath: resolve(outputPath),
          outputSha256: createHash("sha256")
            .update(outputContent)
            .digest("hex"),
          schemaVersion: "maestro-rtk-file-outcome/v2",
          signal: result.signal,
          status: result.status,
        },
        null,
        2,
      )}\n`,
      { flag: "wx" },
    );
  }
  if (result.status !== 0)
    throw new Error(
      `rtk ${args.join(" ")} failed (${result.status ?? "unknown"})`,
    );
  return readFileSync(outputPath, "utf8").trim();
};

export const gitBranchExists = (branch: string, cwd = process.cwd()): boolean =>
  runRtk(["proxy", "git", "branch", "--list", branch], {
    cwd,
    quiet: true,
  }).length > 0;

export const gitCommonDir = (cwd = process.cwd()): string =>
  runRtk(
    ["proxy", "git", "rev-parse", "--path-format=absolute", "--git-common-dir"],
    { cwd, quiet: true },
  );

export const gitIsAncestor = (
  ancestor: string,
  descendant: string,
  cwd = process.cwd(),
): boolean => {
  const result = spawnSync(
    "rtk",
    ["git", "merge-base", "--is-ancestor", ancestor, descendant],
    { cwd, stdio: "ignore" },
  );
  if (result.status === 0) return true;
  if (result.status === 1) return false;
  throw new Error(
    `rtk git merge-base --is-ancestor ${ancestor} ${descendant} failed ` +
      `(${result.status ?? "unknown"})`,
  );
};
