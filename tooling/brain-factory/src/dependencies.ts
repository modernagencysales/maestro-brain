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
