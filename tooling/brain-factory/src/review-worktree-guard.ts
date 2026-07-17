import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const git = (workdir: string, args: readonly string[]): string =>
  execFileSync("rtk", ["proxy", "git", ...args], {
    cwd: workdir,
    encoding: "utf8",
  }).trim();

const gitWithInput = (
  workdir: string,
  args: readonly string[],
  input: string,
): string =>
  execFileSync("rtk", ["proxy", "git", ...args], {
    cwd: workdir,
    encoding: "utf8",
    input,
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

const evidenceGuardRef = (workdir: string, taskId: string): string =>
  `${guardRef(workdir, taskId)}-evidence`;

const updateLengthPrefixed = (
  hash: ReturnType<typeof createHash>,
  value: string | Buffer,
): void => {
  const bytes = typeof value === "string" ? Buffer.from(value) : value;
  hash.update(`${bytes.byteLength}:`);
  hash.update(bytes);
};

const sharedEvidenceDigest = (evidence: string, taskId: string): string => {
  if (!isAbsolute(evidence))
    throw new Error("review guard requires an absolute evidence path");
  const laneEvidence = resolve(evidence, "lane-results", taskId);
  const root = lstatSync(laneEvidence);
  if (root.isSymbolicLink())
    throw new Error("shared review evidence must not contain symlinks");
  if (!root.isDirectory())
    throw new Error("shared review evidence must be a directory");

  const hash = createHash("sha256");
  const visit = (directory: string, relativeDirectory: string): void => {
    const names = readdirSync(directory).sort((left, right) =>
      Buffer.compare(Buffer.from(left), Buffer.from(right)),
    );
    for (const name of names) {
      const path = resolve(directory, name);
      const relativePath =
        relativeDirectory === "" ? name : `${relativeDirectory}/${name}`;
      const stat = lstatSync(path);
      if (stat.isSymbolicLink())
        throw new Error("shared review evidence must not contain symlinks");
      if (stat.isDirectory()) {
        visit(path, relativePath);
        continue;
      }
      if (!stat.isFile())
        throw new Error(
          "shared review evidence must contain only regular files and directories",
        );
      hash.update("file\0");
      updateLengthPrefixed(hash, relativePath);
      updateLengthPrefixed(hash, readFileSync(path));
    }
  };
  visit(laneEvidence, "");
  return hash.digest("hex");
};

const captureGuardRefs = (input: {
  readonly digest: string;
  readonly head: string;
  readonly taskId: string;
  readonly workdir: string;
}): void => {
  const digestBlob = gitWithInput(
    input.workdir,
    ["hash-object", "-w", "--stdin"],
    `${input.digest}\n`,
  );
  gitWithInput(
    input.workdir,
    ["update-ref", "--stdin"],
    [
      "start",
      `update ${guardRef(input.workdir, input.taskId)} ${input.head}`,
      `update ${evidenceGuardRef(input.workdir, input.taskId)} ${digestBlob}`,
      "prepare",
      "commit",
      "",
    ].join("\n"),
  );
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
  readonly evidence: string;
  readonly workdir: string;
  readonly taskId: string;
  readonly proofPath: string;
}): void => {
  const workdir = resolve(input.workdir);
  const evidence = resolve(input.evidence);
  assertExternalRegularProof(workdir, input.proofPath);
  assertClean(workdir);
  const head = git(workdir, ["rev-parse", "HEAD"]);
  captureGuardRefs({
    digest: sharedEvidenceDigest(evidence, input.taskId),
    head,
    taskId: input.taskId,
    workdir,
  });
};

export const verifyReviewWorktree = (input: {
  readonly evidence: string;
  readonly workdir: string;
  readonly taskId: string;
  readonly proofPath: string;
}): void => {
  const workdir = resolve(input.workdir);
  const evidence = resolve(input.evidence);
  assertExternalRegularProof(workdir, input.proofPath);
  const ref = guardRef(workdir, input.taskId);
  const digestRef = evidenceGuardRef(workdir, input.taskId);
  const expectedHead = git(workdir, ["rev-parse", "--verify", ref]);
  const expectedDigestBlob = git(workdir, ["rev-parse", "--verify", digestRef]);
  const expectedDigest = git(workdir, ["cat-file", "blob", expectedDigestBlob]);
  const actualHead = git(workdir, ["rev-parse", "HEAD"]);
  if (actualHead !== expectedHead) {
    throw new Error(
      `review changed HEAD: expected ${expectedHead}, received ${actualHead}`,
    );
  }
  assertClean(workdir);
  const actualDigest = sharedEvidenceDigest(evidence, input.taskId);
  if (actualDigest !== expectedDigest) {
    throw new Error(
      `shared review evidence changed: expected ${expectedDigest}, received ${actualDigest}`,
    );
  }
};

export const releaseReviewWorktreeGuard = (input: {
  readonly workdir: string;
  readonly taskId: string;
}): void => {
  const workdir = resolve(input.workdir);
  const ref = guardRef(workdir, input.taskId);
  const digestRef = evidenceGuardRef(workdir, input.taskId);
  let expectedHead: string;
  let expectedDigestBlob: string;
  try {
    expectedHead = git(workdir, ["rev-parse", "--verify", ref]);
    expectedDigestBlob = git(workdir, ["rev-parse", "--verify", digestRef]);
  } catch {
    return;
  }
  gitWithInput(
    workdir,
    ["update-ref", "--stdin"],
    [
      "start",
      `delete ${ref} ${expectedHead}`,
      `delete ${digestRef} ${expectedDigestBlob}`,
      "prepare",
      "commit",
      "",
    ].join("\n"),
  );
};
