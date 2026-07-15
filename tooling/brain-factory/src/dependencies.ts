import { runRtk } from "./process.js";

type Runner = (
  args: readonly string[],
  options?: { readonly cwd?: string; readonly quiet?: boolean },
) => string;

export const hydrateWorktreeDependencies = (
  _root: string,
  workdir: string,
  runner: Runner = runRtk,
): { readonly linked: 0; readonly mode: "installed" } => {
  runner(
    [
      "pnpm",
      "install",
      "--frozen-lockfile",
      "--prefer-offline",
      "--ignore-scripts",
    ],
    { cwd: workdir },
  );
  return { linked: 0, mode: "installed" };
};

export const isWorkspaceDependencyInput = (file: string): boolean =>
  file === "package.json" ||
  file === "pnpm-lock.yaml" ||
  file === "pnpm-workspace.yaml" ||
  /^(?:apps|packages|tooling)\/[^/]+\/package\.json$/.test(file) ||
  file.startsWith("tooling/patches/");

export const hydrateChangedIntegrationDependencies = (input: {
  readonly baseSha: string;
  readonly runner?: Runner;
  readonly workdir: string;
}):
  | { readonly changedFiles: readonly string[]; readonly mode: "installed" }
  | { readonly changedFiles: readonly []; readonly mode: "unchanged" } => {
  const runner = input.runner ?? runRtk;
  const changedFiles = runner(
    ["proxy", "git", "diff", "--name-only", `${input.baseSha}..HEAD`],
    { cwd: input.workdir, quiet: true },
  )
    .split("\n")
    .filter(isWorkspaceDependencyInput)
    .sort();

  if (changedFiles.length === 0) return { changedFiles: [], mode: "unchanged" };

  hydrateWorktreeDependencies(input.workdir, input.workdir, runner);
  return { changedFiles, mode: "installed" };
};
