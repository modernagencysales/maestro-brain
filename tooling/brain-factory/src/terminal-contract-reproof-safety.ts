import { existsSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

export const containedTerminalReproofFile = (
  root: string,
  path: string,
  label: string,
): string => {
  if (!existsSync(path)) throw new Error(`${label} is missing`);
  const realRoot = realpathSync(root);
  const realPath = realpathSync(path);
  const offset = relative(realRoot, realPath);
  if (offset === "" || offset.startsWith("..") || isAbsolute(offset))
    throw new Error(`${label} escapes its authority root`);
  return realPath;
};

export interface TerminalReproofWorktreeObservation {
  readonly branch: string;
  readonly clean: boolean;
  readonly commonDir: string;
  readonly controlCheckout: boolean;
  readonly factoryRootContained: boolean;
  readonly headSha: string;
  readonly registered: boolean;
  readonly workdir: string;
}

export const observeTerminalReproofWorktree = (input: {
  readonly controlCommonDir: string;
  readonly expectedBranch: string;
  readonly expectedHead?: string;
  readonly root: string;
  readonly runGit: (workdir: string, args: readonly string[]) => string;
  readonly workdir: string;
}): TerminalReproofWorktreeObservation => {
  const controlRoot = realpathSync(input.root);
  const factoryRoot = realpathSync(
    resolve(input.root, "..", ".maestro-brain-fabro-workdirs"),
  );
  const workdir = realpathSync(input.workdir);
  const offset = relative(factoryRoot, workdir);
  const factoryRootContained =
    offset !== "" && !offset.startsWith("..") && !isAbsolute(offset);
  if (!factoryRootContained || workdir === controlRoot)
    throw new Error("terminal owner worktree is unsafe");
  const git = (args: readonly string[]): string => input.runGit(workdir, args);
  const branch = git(["branch", "--show-current"]);
  const headSha = git(["rev-parse", "HEAD"]);
  const commonDir = realpathSync(
    git(["rev-parse", "--path-format=absolute", "--git-common-dir"]),
  );
  const registered = git(["worktree", "list", "--porcelain"])
    .split("\n\n")
    .some((entry) => {
      const lines = new Set(entry.split("\n"));
      return (
        lines.has(`worktree ${workdir}`) &&
        lines.has(`HEAD ${headSha}`) &&
        lines.has(`branch refs/heads/${branch}`)
      );
    });
  if (
    branch !== input.expectedBranch ||
    (input.expectedHead !== undefined && headSha !== input.expectedHead) ||
    commonDir !== realpathSync(input.controlCommonDir) ||
    !registered
  )
    throw new Error("terminal owner registered worktree identity drift");
  return {
    branch,
    clean: git(["status", "--porcelain=v1"]) === "",
    commonDir,
    controlCheckout: workdir === controlRoot,
    factoryRootContained,
    headSha,
    registered,
    workdir,
  };
};
