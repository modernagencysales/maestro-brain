import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const git = (workdir: string, args: readonly string[]): string =>
  execFileSync("rtk", ["proxy", "git", ...args], {
    cwd: workdir,
    encoding: "utf8",
  }).trim();

const guardRef = (workdir: string, taskId: string): string => {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(taskId)) {
    throw new Error(`invalid task id for review guard: ${taskId}`);
  }
  const worktreeHash = createHash("sha256")
    .update(realpathSync(workdir))
    .digest("hex")
    .slice(0, 16);
  return `refs/maestro-brain/review-guards/${taskId}/${worktreeHash}`;
};

const assertExternalRegularProof = (
  workdir: string,
  proofPath: string,
): void => {
  if (!isAbsolute(workdir) || !isAbsolute(proofPath)) {
    throw new Error("review guard requires absolute workdir and proof paths");
  }
  const realWorkdir = realpathSync(workdir);
  const realProof = realpathSync(proofPath);
  const fromWorkdir = relative(realWorkdir, realProof);
  if (
    fromWorkdir === "" ||
    (!fromWorkdir.startsWith("..") && !isAbsolute(fromWorkdir))
  ) {
    throw new Error("review proof must remain outside the reviewed worktree");
  }
  if (!lstatSync(proofPath).isFile() || lstatSync(proofPath).isSymbolicLink()) {
    throw new Error("review proof must be a regular, non-symlink file");
  }
};

const assertClean = (workdir: string): void => {
  const status = git(workdir, [
    "status",
    "--porcelain=v1",
    "--untracked-files=all",
  ]);
  if (status !== "") {
    throw new Error(`review worktree is not clean:\n${status}`);
  }
};

export const captureReviewWorktree = (input: {
  readonly workdir: string;
  readonly taskId: string;
  readonly proofPath: string;
}): void => {
  const workdir = resolve(input.workdir);
  assertExternalRegularProof(workdir, input.proofPath);
  assertClean(workdir);
  const head = git(workdir, ["rev-parse", "HEAD"]);
  git(workdir, ["update-ref", guardRef(workdir, input.taskId), head]);
};

export const verifyReviewWorktree = (input: {
  readonly workdir: string;
  readonly taskId: string;
  readonly proofPath: string;
}): void => {
  const workdir = resolve(input.workdir);
  assertExternalRegularProof(workdir, input.proofPath);
  const ref = guardRef(workdir, input.taskId);
  const expectedHead = git(workdir, ["rev-parse", "--verify", ref]);
  const actualHead = git(workdir, ["rev-parse", "HEAD"]);
  if (actualHead !== expectedHead) {
    throw new Error(
      `review changed HEAD: expected ${expectedHead}, received ${actualHead}`,
    );
  }
  assertClean(workdir);
  git(workdir, ["update-ref", "-d", ref, expectedHead]);
};
